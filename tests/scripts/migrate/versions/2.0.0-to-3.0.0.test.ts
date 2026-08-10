import { describe, it, expect } from "vitest";

/**
 * scripts/migrate/versions/*.mjs has no existing test precedent that runs
 * the raw SQL against a live database (scripts/** is excluded from
 * coverage in vitest.config.ts). What IS meaningfully testable without a
 * live database: the exact DDL text, and the wiring through
 * _registry.mjs and _planner.mjs.
 *
 * This is the squashed v2.0.0 -> v3.0.0 migration: it replaced what used
 * to be nine separately-numbered, never-released schema versions
 * (3.0.0 through 5.9.0). The most important thing this suite verifies is
 * the NET effect: tables/columns that were added and later removed within
 * that same unreleased tail (scan_credentials, scan_history.credential_id)
 * must NOT appear anywhere in the squashed upgrade or the 3.0.0
 * fingerprint, while everything that survived to the end (host_reputation,
 * github_connections, github_review_usage, etc.) must.
 */
const migration = await import("@/scripts/migrate/versions/2.0.0-to-3.0.0.mjs");
const { transitions, findVersionFile, VERSIONS, getVersion } =
  await import("@/scripts/migrate/_registry.mjs");
const { buildPlan } = await import("@/scripts/migrate/_planner.mjs");

describe("2.0.0-to-3.0.0 migration: exports", () => {
  it("declares the correct from/to versions", () => {
    expect(migration.from).toBe("2.0.0");
    expect(migration.to).toBe("3.0.0");
  });

  it("upgrade adds every table that survives to the final v3.0.0 shape", () => {
    const names = migration.upgrade.addTables.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "ai_conversations",
        "browser_sessions",
        "scan_finding_feedback",
        "user_notifications",
        "host_reputation",
        "github_connections",
        "github_review_usage",
        // AUDIT-009 migration-01: these 4 existed in instrumentation.ts
        // but were missing from this migration file until the fix.
        "processed_stripe_events",
        "user_ai_configs",
        "cve_kev_cache",
        "webhook_deliveries",
      ]),
    );
    expect(names).toHaveLength(11);
  });

  it("upgrade adds every AUDIT-009 migration-01 column that was missing from this file", () => {
    const columns = migration.upgrade.addColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "api_keys.scopes",
        "users.ai_chat_banned",
        "users.google_id",
        "users.google_email",
        "users.google_name",
        "users.google_avatar_url",
        "users.github_id",
        "users.github_email",
        "users.github_name",
        "users.github_avatar_url",
        "users.discord_username",
        "users.discord_avatar_url",
        "users.discord_email",
        "users.scans_private_by_default",
        "scan_history.share_expires_at",
        "scan_history.is_public",
        "broadcast_messages.sent_by",
        "scheduled_scans.preferred_hour_utc",
        "scheduled_scans.preferred_day_of_week",
        "scheduled_scans.preferred_day_of_month",
        "webhooks.secret",
        "host_reputation.findings",
        "host_reputation.response_headers",
        "host_reputation.result_meta",
        "host_reputation.authenticated",
        "host_reputation.scanned_url",
      ]),
    );
  });

  it("upgrade adds idx_scan_history_url_public_completed", () => {
    const names = migration.upgrade.addIndexes.map((i) => i.name);
    expect(names).toContain("idx_scan_history_url_public_completed");
  });

  it("upgrade never creates scan_credentials (added then removed within the squashed range)", () => {
    const names = migration.upgrade.addTables.map((t) => t.name);
    expect(names).not.toContain("scan_credentials");
    const allSql = migration.upgrade.addTables.map((t) => t.sql).join("\n");
    expect(allSql).not.toContain("scan_credentials");
  });

  it("upgrade never adds scan_history.credential_id", () => {
    const columns = migration.upgrade.addColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).not.toContain("scan_history.credential_id");
  });

  it("upgrade adds scan_history.authenticated and scan_type but not credential_id", () => {
    const columns = migration.upgrade.addColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "scan_history.authenticated",
        "scan_history.scan_type",
        "users.auth_provider",
        "api_keys.bound_ip",
      ]),
    );
  });

  it("upgrade includes the super_admin backfill and OAuth data updates", () => {
    const sqls = migration.upgrade.dataUpdates.map((d) => d.sql);
    expect(sqls.some((s) => s.includes("super_admin"))).toBe(true);
    expect(
      sqls.some(
        (s) => s.includes("password_hash") && s.includes("DROP NOT NULL"),
      ),
    ).toBe(true);
    expect(sqls.some((s) => s.includes("auth_provider = 'password'"))).toBe(
      true,
    );
  });

  it("downgrade drops every table the upgrade added", () => {
    expect(migration.downgrade.dropTables).toEqual(
      expect.arrayContaining([
        "ai_conversations",
        "browser_sessions",
        "scan_finding_feedback",
        "user_notifications",
        "host_reputation",
        "github_connections",
        "github_review_usage",
        "processed_stripe_events",
        "user_ai_configs",
        "cve_kev_cache",
        "webhook_deliveries",
      ]),
    );
    expect(migration.downgrade.dropTables).not.toContain("scan_credentials");
    expect(migration.downgrade.dropTables).toHaveLength(11);
  });

  it("downgrade drops every AUDIT-009 migration-01 column, except columns on tables it already drops wholesale", () => {
    const columns = migration.downgrade.dropColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "api_keys.scopes",
        "users.ai_chat_banned",
        "users.google_id",
        "users.discord_username",
        "users.scans_private_by_default",
        "scan_history.share_expires_at",
        "scan_history.is_public",
        "broadcast_messages.sent_by",
        "scheduled_scans.preferred_hour_utc",
        "webhooks.secret",
      ]),
    );
    // host_reputation.* and user_ai_configs.ai_disabled are NOT here: those
    // tables are already in dropTables above, and CASCADE-dropping a table
    // removes its columns -- an explicit DROP COLUMN on a table that no
    // longer exists would error.
    expect(columns).not.toContain("host_reputation.findings");
    expect(columns).not.toContain("user_ai_configs.ai_disabled");
  });

  it("downgrade drops idx_scan_history_url_public_completed", () => {
    expect(migration.downgrade.dropIndexes).toContain(
      "idx_scan_history_url_public_completed",
    );
  });
});

describe("2.0.0-to-3.0.0 migration: registry + planner wiring", () => {
  it("registry has exactly 1.0.0, 2.0.0, 3.0.0", () => {
    expect(VERSIONS.map((v) => v.name)).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
  });

  it("the 3.0.0 fingerprint includes the key new tables", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("host_reputation")).toBe(true);
    expect(v.fingerprint.tables.has("github_connections")).toBe(true);
    expect(v.fingerprint.tables.has("github_review_usage")).toBe(true);
  });

  it("the 3.0.0 fingerprint does NOT include scan_credentials", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("scan_credentials")).toBe(false);
  });

  it("has a registered upgrade transition from 2.0.0 to 3.0.0 in exactly one step", () => {
    const steps = transitions("2.0.0", "3.0.0");
    expect(steps).toEqual([
      { from: "2.0.0", to: "3.0.0", direction: "upgrade" },
    ]);
  });

  it("resolves to this version file on disk", () => {
    const file = findVersionFile({ from: "2.0.0", to: "3.0.0" });
    expect(file.replace(/\\/g, "/")).toMatch(
      /scripts\/migrate\/versions\/2\.0\.0-to-3\.0\.0\.mjs$/,
    );
  });

  it("buildPlan(2.0.0, 3.0.0) produces a non-empty, reasonable set of steps", async () => {
    const plan = await buildPlan("2.0.0", "3.0.0");
    expect(plan.steps.length).toBeGreaterThan(10);
    const createTableSteps = plan.steps.filter(
      (s: { kind: string }) => s.kind === "createTable",
    );
    // 7 original tables + 4 added by AUDIT-009 migration-01
    // (processed_stripe_events, user_ai_configs, cve_kev_cache,
    // webhook_deliveries) that instrumentation.ts had but this file didn't.
    expect(createTableSteps.length).toBe(11);
    expect(
      createTableSteps.some((s: { label: string }) =>
        s.label.includes("scan_credentials"),
      ),
    ).toBe(false);
  });

  it("buildPlan(3.0.0, 2.0.0) (downgrade) marks table/column drops destructive", async () => {
    const plan = await buildPlan("3.0.0", "2.0.0");
    expect(plan.steps.length).toBeGreaterThan(0);
    const dropTableSteps = plan.steps.filter(
      (s: { kind: string }) => s.kind === "dropTable",
    );
    expect(dropTableSteps.length).toBe(11);
    expect(
      dropTableSteps.every((s: { destructive: boolean }) => s.destructive),
    ).toBe(true);
  });
});
