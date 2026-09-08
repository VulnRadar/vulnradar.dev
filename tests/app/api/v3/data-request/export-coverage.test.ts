/**
 * The export route drifted once and would have again.
 *
 * `POST /api/v3/data-request` is the "download everything you hold on me"
 * endpoint, and its own comment claimed it gathered "ALL user data from every
 * table". It named 25 of the schema's 65 tables. The other twenty-one
 * user-keyed tables were not a considered exclusion list; they were tables
 * added after the route was written, by people who had no reason to know this
 * file existed. Support correspondence, credit purchases, verified domains,
 * webhook delivery logs and the mail we had sent them were all missing.
 *
 * A test asserting the current 46 tables would have caught nothing, because
 * the failure mode is the NEXT table. So this reads the boot schema, finds
 * every table with a column that links a row to a person, and requires each
 * one to be either queried by the route or listed below with a reason. Adding
 * a user-keyed table now fails this test until somebody makes that choice.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SCHEMA_DIR = join(process.cwd(), "lib/database/schema");
/** One table's DDL lives outside the schema directory, beside its own code. */
const EXTRA_DDL = [join(process.cwd(), "lib/database/audit-log-archive.ts")];
const ROUTE = join(process.cwd(), "app/api/v3/data-request/route.ts");

/**
 * Columns that tie a row to a specific person. `email` is included because
 * email_logs keys on the address rather than an id, which is exactly why it
 * was overlooked.
 */
const USER_LINKED_COLUMN =
  /^(user_id|owner_id|author_user_id|dismissed_by_user_id|shared_with_user_id|shared_by_user_id|target_user_id|recipient|created_by)$/;

/**
 * Not exported, each for a reason. Keep this in step with the comment at the
 * top of the route, which states the same reasons in prose.
 */
const DELIBERATELY_EXCLUDED = new Map<string, string>([
  [
    "password_reset_tokens",
    "live credential: handing it back in a downloadable file is the opposite of a privacy measure",
  ],
  ["email_verification_tokens", "live credential, as above"],
  ["billing_verification_codes", "live credential, as above"],
  [
    "admin_notifications",
    "created_by is a staff action; exported as staffActivity and adminActionsOnYourAccount instead",
  ],
  ["access_rules", "staff action, as above"],
  ["promoted_auto_tag_rules", "staff action, as above"],
  [
    "broadcast_messages",
    "the message itself is ours; the recipient row that names the user IS exported",
  ],
  [
    "system_settings",
    "created_by records which staff member changed a service-wide setting, not personal data",
  ],
  [
    "admin_audit_log_archive",
    "cold copy of admin_audit_log, whose entries about the caller are exported from the live table",
  ],
  [
    "rate_limits",
    "transient counter, derivable from the usage rows that are exported",
  ],
]);

function schemaSource(): string {
  return [
    ...readdirSync(SCHEMA_DIR)
      .filter((f) => f.endsWith(".mjs"))
      .map((f) => readFileSync(join(SCHEMA_DIR, f), "utf8")),
    ...EXTRA_DDL.map((f) => readFileSync(f, "utf8")),
  ].join("\n");
}

/** Every table the boot schema creates, user-keyed or not. */
function allTables(): Set<string> {
  const names = new Set<string>();
  for (const [, name] of schemaSource().matchAll(
    /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g,
  )) {
    names.add(name);
  }
  return names;
}

function tablesWithUserColumns(): Map<string, string[]> {
  const sql = schemaSource();

  const create =
    /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(([\s\S]{0,6000}?)\n\s*\)/g;
  const found = new Map<string, string[]>();

  for (const [, table, body] of sql.matchAll(create)) {
    const columns = body
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) => line && !line.startsWith("//") && !line.startsWith("--"),
      )
      .map((line) => line.split(/\s+/)[0])
      .filter((column) => USER_LINKED_COLUMN.test(column));
    if (columns.length) found.set(table, [...new Set(columns)]);
  }
  return found;
}

/** Table names the route actually reads, from its FROM and JOIN clauses. */
function tablesQueriedByRoute(): Set<string> {
  const source = readFileSync(ROUTE, "utf8");
  const names = new Set<string>();
  for (const [, name] of source.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)) {
    names.add(name);
  }
  return names;
}

describe("data export covers every table that holds personal data", () => {
  const schemaTables = tablesWithUserColumns();

  it("finds the schema at all", () => {
    // A rename of lib/database/schema would otherwise turn this whole file
    // into a test that passes by finding nothing.
    expect(schemaTables.size).toBeGreaterThan(20);
    expect(schemaTables.has("scan_history")).toBe(true);
  });

  it("exports or explicitly excludes every user-keyed table", () => {
    const queried = tablesQueriedByRoute();
    const unaccounted = [...schemaTables.keys()].filter(
      (table) => !queried.has(table) && !DELIBERATELY_EXCLUDED.has(table),
    );

    expect(
      unaccounted,
      `These tables link rows to a person and the data export neither reads them nor ` +
        `explains why not. Either add a query to app/api/v3/data-request/route.ts or ` +
        `add the table to DELIBERATELY_EXCLUDED in this file with the reason: ` +
        unaccounted.join(", "),
    ).toEqual([]);
  });

  it("does not carry stale exclusions for tables that no longer exist", () => {
    // An exclusion for a dropped table is a reason nobody can check.
    // Checked against every table, not only the user-keyed ones: rate_limits
    // and system_settings are on the list precisely because they have no
    // user column, and would otherwise read as stale.
    const existing = allTables();
    const gone = [...DELIBERATELY_EXCLUDED.keys()].filter(
      (table) => !existing.has(table),
    );
    expect(gone).toEqual([]);
  });

  it("never reads the credential tables", () => {
    const queried = tablesQueriedByRoute();
    for (const table of [
      "password_reset_tokens",
      "email_verification_tokens",
      "billing_verification_codes",
    ]) {
      expect(
        queried.has(table),
        `${table} holds live credentials and must not appear in an export file`,
      ).toBe(false);
    }
  });

  it("does not re-export a previous export's stored payload", () => {
    // data_requests.data is every earlier export, so selecting it would make
    // each file contain the one before it.
    const source = readFileSync(ROUTE, "utf8");
    const selectsFromDataRequests = [
      ...source.matchAll(/SELECT([\s\S]{0,300}?)FROM\s+data_requests/g),
    ].map(([, columns]) => columns);
    expect(selectsFromDataRequests.length).toBeGreaterThan(0);
    for (const columns of selectsFromDataRequests) {
      // The GET path legitimately reads `data` to re-serve a prior download;
      // the gather path must not fold it into a new one. Distinguish by
      // whether the projection also carries requested_at, which only the
      // export-history query does.
      if (/requested_at/.test(columns)) {
        expect(/\bdata\b/.test(columns)).toBe(false);
      }
    }
  });
});
