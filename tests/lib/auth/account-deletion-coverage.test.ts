/**
 * The erasure path has the same drift problem the data export had.
 *
 * `lib/auth/account-deletion.ts` is the single definition of "permanently
 * erase this account", shared by the admin and self-service routes. It works
 * by a mix of database cascades and explicit DELETEs, and the explicit ones
 * exist precisely for columns whose foreign key is ON DELETE SET NULL: the row
 * survives with the person's id removed while still carrying what they wrote.
 * That was fixed once for scan_finding_feedback, and the same shape was still
 * live on support_ticket_messages, where a reply written on a ticket shared
 * with the account outlived it on a thread its owner could still read.
 *
 * Asserting today's list would catch nothing, because the failure mode is the
 * next SET NULL column somebody adds. So this reads the boot schema, finds
 * every column that links a row to a person, and requires each one to be
 * cascading, explicitly deleted, or listed below as deliberately anonymised.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = join(process.cwd(), "lib/database/schema");
const DELETION = join(process.cwd(), "lib/auth/account-deletion.ts");

const USER_LINKED_COLUMN =
  /^(user_id|owner_id|author_user_id|dismissed_by_user_id|shared_with_user_id|shared_by_user_id|target_user_id|created_by|resolved_by|impersonated_by|updated_by|sent_by)$/;

/**
 * Columns where leaving the row behind with a null person is the intended
 * outcome, not an oversight. Each entry says what survives and why that is
 * acceptable, because "it is anonymised" is only true if the remaining row
 * carries nothing that identifies anybody.
 */
const ANONYMISED_ON_PURPOSE = new Map<string, string>([
  [
    "admin_audit_log.target_user_id",
    "the platform's record of what staff did; de-identified in place by the deletion path rather than erased, so an admin action still has a trail",
  ],
  [
    "admin_notifications.created_by",
    "a service-wide notice authored by staff; the notice outlives its author and carries no personal data of theirs",
  ],
  [
    "access_rules.created_by",
    "a service-wide block rule; same reasoning as admin_notifications",
  ],
  [
    "promoted_auto_tag_rules.created_by",
    "a scanner rule promoted by staff; the rule is the product, the authorship is not personal content",
  ],
  [
    "broadcast_messages.created_by",
    "the announcement itself is ours and stays; the recipient rows that name people cascade",
  ],
  [
    "broadcast_messages.sent_by",
    "as created_by; nulled by the FK so an erasure is never blocked",
  ],
  [
    "system_settings.updated_by",
    "records that a setting changed, not who the person was once they are gone",
  ],
  [
    "auto_tag_dismissals.dismissed_by_user_id",
    "the row is a tag name against a scan; with the person nulled it holds nothing about them",
  ],
  [
    "security_alerts.resolved_by",
    "the alert belongs to its subject, whose own rows are deleted; the resolver is staff",
  ],
  [
    "sessions.impersonated_by",
    "the impersonated session cascades with its own user; this column names the staff member",
  ],
]);

function schemaSource(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8"))
    .join("\n");
}

type Link = { table: string; column: string; onDelete: string };

function userLinkedColumns(): Link[] {
  const create =
    /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]{0,6000}?)\n\s*\)/g;
  const links: Link[] = [];

  for (const [, table, body] of schemaSource().matchAll(create)) {
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("--")) continue;
      const column = line.split(/\s+/)[0];
      if (!USER_LINKED_COLUMN.test(column)) continue;
      const onDelete = /ON DELETE CASCADE/i.test(line)
        ? "CASCADE"
        : /ON DELETE SET NULL/i.test(line)
          ? "SET NULL"
          : /REFERENCES/i.test(line)
            ? "NO ACTION"
            : "NO FK";
      links.push({ table, column, onDelete });
    }
  }
  return links;
}

function explicitlyDeleted(): Set<string> {
  const source = readFileSync(DELETION, "utf8");
  const tables = new Set<string>();
  for (const [, table] of source.matchAll(/DELETE FROM ([a-z_]+)/g)) {
    tables.add(table);
  }
  // The audit log is de-identified with an UPDATE rather than deleted.
  for (const [, table] of source.matchAll(/UPDATE ([a-z_]+)\s+SET/g)) {
    tables.add(table);
  }
  return tables;
}

describe("account deletion reaches every column that links a row to a person", () => {
  const links = userLinkedColumns();

  it("finds the schema at all", () => {
    expect(links.length).toBeGreaterThan(20);
    expect(links.some((l) => l.table === "scan_history")).toBe(true);
  });

  it("leaves nothing behind that was not deliberately anonymised", () => {
    const handled = explicitlyDeleted();
    const unaccounted = links.filter(
      (l) =>
        l.onDelete !== "CASCADE" &&
        !handled.has(l.table) &&
        !ANONYMISED_ON_PURPOSE.has(`${l.table}.${l.column}`),
    );

    expect(
      unaccounted.map((l) => `${l.table}.${l.column} (${l.onDelete})`),
      "These columns point at a person, do not cascade, and the deletion path " +
        "neither removes nor documents them. A SET NULL leaves the row and " +
        "everything written in it. Either add a DELETE to " +
        "lib/auth/account-deletion.ts or add the column to " +
        "ANONYMISED_ON_PURPOSE in this file, saying what survives and why " +
        "that is acceptable.",
    ).toEqual([]);
  });

  it("has no FK that would block an erasure outright", () => {
    // ON DELETE NO ACTION on a column pointing at users(id) makes DELETE FROM
    // users raise a foreign-key violation and roll the whole transaction back,
    // so the account cannot be deleted at all. This happened once, on
    // broadcast_messages.created_by, for any staff member who had ever sent an
    // announcement. lib/database/schema/04-constraints.mjs widens the known
    // ones; a new NO ACTION column has to be added there, not tolerated here.
    const constraints = readFileSync(
      join(SCHEMA_DIR, "04-constraints.mjs"),
      "utf8",
    );
    const blocking = links.filter(
      (l) =>
        l.onDelete === "NO ACTION" &&
        !new RegExp(
          `table:\\s*"${l.table}"[\\s\\S]{0,80}column:\\s*"${l.column}"`,
        ).test(constraints) &&
        // A later ALTER in the boot sequence may widen it; accept a column the
        // schema explicitly re-points at ON DELETE SET NULL somewhere.
        !new RegExp(
          `ALTER TABLE ${l.table}[\\s\\S]{0,400}${l.column}[\\s\\S]{0,120}ON DELETE SET NULL`,
        ).test(schemaSource()),
    );

    expect(
      blocking.map((l) => `${l.table}.${l.column}`),
      "A foreign key with no ON DELETE clause defaults to NO ACTION, which " +
        "makes deleting the user fail rather than cascade. Add the column to " +
        "NON_CASCADING_FOREIGN_KEYS in lib/database/schema/04-constraints.mjs.",
    ).toEqual([]);
  });

  it("does not carry stale anonymisation entries", () => {
    // Presence is checked textually rather than against the parsed CREATE
    // TABLE bodies, because some of these columns were added by a later ALTER
    // in the boot sequence and never appear in a CREATE TABLE at all.
    const source = schemaSource();
    const present = new Set(links.map((l) => `${l.table}.${l.column}`));
    const gone = [...ANONYMISED_ON_PURPOSE.keys()].filter((key) => {
      if (present.has(key)) return false;
      const [table, column] = key.split(".");
      return !(
        source.includes(table) && new RegExp(`\\b${column}\\b`).test(source)
      );
    });
    expect(gone).toEqual([]);
  });
});
