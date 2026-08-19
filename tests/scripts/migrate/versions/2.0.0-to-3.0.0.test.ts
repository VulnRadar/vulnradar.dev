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
        // Per-finding remediation status lifecycle, persisted across rescans.
        "finding_remediation",
        "user_notifications",
        "host_reputation",
        // Stable per-user-per-URL token for the auto-updating embed badge.
        "host_badges",
        "github_connections",
        "github_review_usage",
        // AUDIT-009 migration-01: these 4 existed in instrumentation.ts
        // but were missing from this migration file until the fix.
        "processed_stripe_events",
        "user_ai_configs",
        "cve_kev_cache",
        "webhook_deliveries",
        // Unified AI usage tracking, folded into this same squashed step
        // for the same reason as the AUDIT-009 additions above -- see
        // this file's header comment.
        "ai_usage",
        // Admin > System > Error Logs store, folded in for the same
        // "schema v3.0.0 never shipped" reason as ai_usage above.
        "system_error_logs",
        // Auto tag dismissals (Admin > Engine Feedback), folded in for the
        // same reason.
        "auto_tag_dismissals",
        // Admin-promoted auto-tag rules (Admin > Engine Feedback > AI Tag
        // Candidates), folded in for the same reason.
        "promoted_auto_tag_rules",
        // AI credit purchase idempotency ledger (confirmAiCreditPurchase vs.
        // the payment_intent.succeeded webhook), folded in for the same
        // reason.
        "ai_credit_purchases",
      ]),
    );
    expect(names).toHaveLength(18);
  });

  it("upgrade adds the finding_remediation table (per-finding remediation status lifecycle)", () => {
    const table = migration.upgrade.addTables.find(
      (t: { name: string }) => t.name === "finding_remediation",
    );
    expect(table).toBeDefined();
    expect(table?.sql).toContain(
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE",
    );
    expect(table?.sql).toContain("finding_id TEXT NOT NULL");
    expect(table?.sql).toContain("finding_url TEXT NOT NULL");
    expect(table?.sql).toContain(
      "CHECK (status IN ('open', 'in_progress', 'fixed', 'accepted_risk', 'wont_fix'))",
    );
    // Keyed on the stable (user_id, finding_id, finding_url), NOT the scan
    // row id -- this is what makes a status survive rescans of the target.
    expect(table?.sql).toContain(
      "ON finding_remediation (user_id, finding_id, finding_url)",
    );
  });

  it("upgrade adds the ai_credit_purchases table (AI credit purchase idempotency ledger)", () => {
    const table = migration.upgrade.addTables.find(
      (t) => t.name === "ai_credit_purchases",
    );
    expect(table).toBeDefined();
    expect(table?.sql).toContain("payment_intent_id VARCHAR(255) PRIMARY KEY");
    expect(table?.sql).toContain(
      "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE",
    );
    expect(table?.sql).toContain("tokens BIGINT NOT NULL");
  });

  it("upgrade adds the auto_tag_dismissals table (auto-tag feedback/dismissal log)", () => {
    const table = migration.upgrade.addTables.find(
      (t) => t.name === "auto_tag_dismissals",
    );
    expect(table).toBeDefined();
    expect(table?.sql).toContain(
      "scan_id INTEGER NOT NULL REFERENCES scan_history(id)",
    );
    expect(table?.sql).toContain(
      "dismissed_by_user_id INTEGER REFERENCES users(id)",
    );
    expect(table?.sql).toContain("UNIQUE(scan_id, tag)");
  });

  it("upgrade adds the promoted_auto_tag_rules table (admin-promoted AI tag candidates)", () => {
    const table = migration.upgrade.addTables.find(
      (t) => t.name === "promoted_auto_tag_rules",
    );
    expect(table).toBeDefined();
    expect(table?.sql).toContain("tag VARCHAR(50) NOT NULL UNIQUE");
    expect(table?.sql).toContain("cwes JSONB");
    expect(table?.sql).toContain("categories JSONB");
    expect(table?.sql).toContain("require_both BOOLEAN NOT NULL DEFAULT FALSE");
    expect(table?.sql).toContain(
      "CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical'))",
    );
    expect(table?.sql).toContain(
      "created_by INTEGER REFERENCES users(id) ON DELETE SET NULL",
    );
    expect(table?.sql).toContain(
      "CHECK (cwes IS NOT NULL OR categories IS NOT NULL)",
    );
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

  it("upgrade adds the Public Scans directory columns (independent of is_public/scans_private_by_default)", () => {
    const columns = migration.upgrade.addColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "scan_history.share_publicly_listed",
        "users.share_publicly_listed_by_default",
      ]),
    );
  });

  it("upgrade adds users.ai_credit_balance for one-time AI credit purchases", () => {
    const column = migration.upgrade.addColumns.find(
      (c) => c.table === "users" && c.column === "ai_credit_balance",
    );
    expect(column).toBeDefined();
    expect(column?.definition).toBe("BIGINT NOT NULL DEFAULT 0");
  });

  it("upgrade adds users.free_github_review_used_at for the free-plan daily GitHub AI review trial", () => {
    const column = migration.upgrade.addColumns.find(
      (c) => c.table === "users" && c.column === "free_github_review_used_at",
    );
    expect(column).toBeDefined();
    expect(column?.definition).toBe("TIMESTAMPTZ");
  });

  it("upgrade adds host_badges.scope for the global/per-user badge toggle, defaulting to 'user'", () => {
    const column = migration.upgrade.addColumns.find(
      (c) => c.table === "host_badges" && c.column === "scope",
    );
    expect(column).toBeDefined();
    expect(column?.definition).toContain("DEFAULT 'user'");
    expect(column?.definition).toContain("CHECK (scope IN ('user', 'global'))");
  });

  it("upgrade adds users.pre_staff_plan and backfills existing staff accounts", () => {
    const columns = migration.upgrade.addColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toContain("users.pre_staff_plan");

    const backfill = migration.upgrade.dataUpdates.find((d) =>
      d.sql.includes("pre_staff_plan"),
    );
    expect(backfill).toBeDefined();
    expect(backfill?.sql).toContain("plan = 'pro_supporter'");
    expect(backfill?.sql).toContain(
      "role IN ('admin', 'moderator', 'support')",
    );
    // Idempotency guard -- never overwrites an already-recorded original plan.
    expect(backfill?.sql).toContain("pre_staff_plan IS NULL");
    // super_admin is un-assignable through the admin panel and is
    // deliberately excluded from the staff-role set this backfill uses.
    expect(backfill?.sql).not.toContain("super_admin");
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
        "finding_remediation",
        "user_notifications",
        "host_reputation",
        "host_badges",
        "github_connections",
        "github_review_usage",
        "processed_stripe_events",
        "user_ai_configs",
        "cve_kev_cache",
        "webhook_deliveries",
        "ai_usage",
        "system_error_logs",
        "auto_tag_dismissals",
        "promoted_auto_tag_rules",
        "ai_credit_purchases",
      ]),
    );
    expect(migration.downgrade.dropTables).not.toContain("scan_credentials");
    expect(migration.downgrade.dropTables).toHaveLength(18);
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

  it("downgrade drops the Public Scans directory columns", () => {
    const columns = migration.downgrade.dropColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "scan_history.share_publicly_listed",
        "users.share_publicly_listed_by_default",
      ]),
    );
  });

  it("downgrade drops users.pre_staff_plan", () => {
    const columns = migration.downgrade.dropColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toContain("users.pre_staff_plan");
  });

  it("downgrade drops users.ai_credit_balance", () => {
    const columns = migration.downgrade.dropColumns.map(
      (c) => `${c.table}.${c.column}`,
    );
    expect(columns).toContain("users.ai_credit_balance");
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
    expect(v.fingerprint.tables.has("host_badges")).toBe(true);
    expect(v.fingerprint.tables.has("github_connections")).toBe(true);
    expect(v.fingerprint.tables.has("github_review_usage")).toBe(true);
    expect(v.fingerprint.tables.has("ai_usage")).toBe(true);
  });

  it("the 3.0.0 fingerprint includes finding_remediation and its columns", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("finding_remediation")).toBe(true);
    expect(v.fingerprint.columns.finding_remediation).toEqual(
      new Set([
        "id",
        "user_id",
        "finding_id",
        "finding_url",
        "status",
        "note",
        "assignee",
        "created_at",
        "updated_at",
      ]),
    );
  });

  it("the 3.0.0 fingerprint's ai_usage columns match the unified AI usage table shape", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.columns.ai_usage).toEqual(
      new Set(["user_id", "window_start", "tokens_used", "updated_at"]),
    );
  });

  it("the 3.0.0 fingerprint includes the Public Scans directory columns", () => {
    const v = getVersion("3.0.0");
    expect(
      v.fingerprint.columns.users?.has("share_publicly_listed_by_default"),
    ).toBe(true);
    expect(
      v.fingerprint.columns.scan_history?.has("share_publicly_listed"),
    ).toBe(true);
  });

  it("the 3.0.0 fingerprint includes host_badges.scope", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.columns.host_badges?.has("scope")).toBe(true);
  });

  it("the 3.0.0 fingerprint includes users.pre_staff_plan", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.columns.users?.has("pre_staff_plan")).toBe(true);
  });

  it("the 3.0.0 fingerprint includes users.ai_credit_balance", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.columns.users?.has("ai_credit_balance")).toBe(true);
  });

  it("the 3.0.0 fingerprint includes users.free_github_review_used_at", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.columns.users?.has("free_github_review_used_at")).toBe(
      true,
    );
  });

  it("the 3.0.0 fingerprint includes auto_tag_dismissals and its columns", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("auto_tag_dismissals")).toBe(true);
    expect(v.fingerprint.columns.auto_tag_dismissals).toEqual(
      new Set(["id", "scan_id", "tag", "dismissed_by_user_id", "dismissed_at"]),
    );
  });

  it("the 3.0.0 fingerprint includes promoted_auto_tag_rules and its columns", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("promoted_auto_tag_rules")).toBe(true);
    expect(v.fingerprint.columns.promoted_auto_tag_rules).toEqual(
      new Set([
        "id",
        "tag",
        "cwes",
        "categories",
        "require_both",
        "min_severity",
        "min_count",
        "source_ai_tag",
        "created_by",
        "created_at",
      ]),
    );
  });

  it("the 3.0.0 fingerprint includes ai_credit_purchases and its columns", () => {
    const v = getVersion("3.0.0");
    expect(v.fingerprint.tables.has("ai_credit_purchases")).toBe(true);
    expect(v.fingerprint.columns.ai_credit_purchases).toEqual(
      new Set(["payment_intent_id", "user_id", "tokens", "credited_at"]),
    );
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
    // webhook_deliveries) that instrumentation.ts had but this file didn't,
    // + 1 for the unified AI usage table (ai_usage),
    // + 1 for the admin error-logs table (system_error_logs),
    // + 1 for the auto-tag dismissal log (auto_tag_dismissals),
    // + 1 for admin-promoted auto-tag rules (promoted_auto_tag_rules),
    // + 1 for the AI credit purchase idempotency ledger
    // (ai_credit_purchases),
    // + 1 for the auto-updating embed badge tokens (host_badges),
    // + 1 for the per-finding remediation status lifecycle
    // (finding_remediation).
    expect(createTableSteps.length).toBe(18);
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
    expect(dropTableSteps.length).toBe(18);
    expect(
      dropTableSteps.every((s: { destructive: boolean }) => s.destructive),
    ).toBe(true);
  });
});
