/**
 * VulnRadar boot schema, part 4 of 4: the constraint and trigger layer.
 *
 * This file is the reason ./index.mjs exists at all.
 *
 * Every step below used to be written as a `for (const x of [...])` loop
 * around `pool.query(\`ALTER TABLE ${x.table} ...\`)` in instrumentation.ts.
 * That is correct code and it ran correctly on every boot. What it was not is
 * READABLE BY TEXT EXTRACTION: scripts/_lib/_lib.schema-parity.mjs pulled the
 * template literals out of instrumentation.ts as source text, so what it got
 * for these six statements was the literal string `ALTER TABLE ${fk.table}`,
 * which it then dropped. `npm run db:create` used that extraction, so a
 * database it built had:
 *
 *   - no ON DELETE SET NULL on the four bookkeeping foreign keys, so deleting
 *     a user any of them referenced failed the whole erasure transaction
 *   - none of the six value-set CHECK constraints
 *   - no vulnradar_set_updated_at() and none of the seven updated_at triggers,
 *     so users.updated_at (which both GDPR export paths hand to the user as
 *     the account's last-modified timestamp) was simply wrong
 *   - none of the redundant-index drops
 *
 * and nobody was told, because db:create logs a warning for a statement it
 * cannot run and carries on. Nothing had ever executed these two paths against
 * two databases and compared the result.
 *
 * The loops are still here, because the data really is tabular and a list of
 * 46 hand-written statements would be worse. The difference is that they are
 * expanded into concrete SchemaStep objects AT MODULE LOAD, so every consumer
 * gets real SQL strings with the names already substituted, and none of them
 * has to parse anything.
 */

/**
 * Every index that duplicates something the database already has, so none of
 * them can ever be chosen over the copy that stays. Their CREATE statements
 * are gone from this schema and from scripts/migrate/versions, so a fresh
 * database never grows them and an existing one sheds them on the next boot.
 * ref: AUDIT-013#schema-05
 *
 * Two shapes, both pure write amplification:
 *
 *   1. A duplicate of a UNIQUE constraint. PostgreSQL implements UNIQUE as a
 *      unique b-tree index on the same columns, so a separate CREATE INDEX on
 *      those columns is a second copy of an index that already exists. The
 *      UNIQUE constraints all stay: they are the ones doing the work.
 *
 *   2. A strict prefix of a wider index or key. A b-tree on (A, B) serves a
 *      filter on A alone, so a single-column index on A adds nothing. See the
 *      performance-indexes step in 02-features.mjs for the mistaken reasoning
 *      that created three of these.
 *
 * The cost was paid on every INSERT, UPDATE and DELETE on the hottest tables
 * in the schema (rate_limits is written on every rate-limited request, then
 * api_usage, scan_history, device_trust), plus the extra vacuum work and the
 * shared_buffers those pages occupied.
 */
export const REDUNDANT_INDEXES = [
  // Duplicates of a UNIQUE constraint.
  "idx_users_email", // users.email UNIQUE
  "idx_users_stripe_customer", // users.stripe_customer_id UNIQUE
  "idx_api_keys_key_hash", // api_keys.key_hash UNIQUE
  "idx_scan_history_share_token", // scan_history.share_token UNIQUE
  "idx_badges_name", // badges.name UNIQUE
  "idx_discord_user", // discord_connections.user_id UNIQUE
  "idx_discord_id", // discord_connections.discord_id UNIQUE
  "idx_notif_prefs_user_id", // notification_preferences.user_id UNIQUE
  "idx_team_invites_token", // team_invites.token UNIQUE
  "idx_staff_invites_token", // staff_invites.token UNIQUE
  "idx_admin_notifications_cookie", // admin_notifications.cookie_id UNIQUE
  "idx_ai_conversations_session_id", // ai_conversations.session_id UNIQUE
  "idx_user_ai_configs_user_id", // user_ai_configs.user_id UNIQUE
  "idx_github_connections_user", // github_connections.user_id UNIQUE
  "idx_github_review_usage_user_window", // github_review_usage_user_window_key
  "idx_promoted_auto_tag_rules_tag", // promoted_auto_tag_rules.tag UNIQUE
  // Strict prefixes of a wider index, key or constraint.
  "idx_scan_history_user_id", // idx_scan_history_user_scanned(user_id, scanned_at)
  "idx_api_usage_key_id", // idx_api_usage_key_used(api_key_id, used_at)
  "idx_admin_audit_admin_id", // idx_admin_audit_admin_created(admin_id, created_at)
  "idx_scan_tags_scan_id", // UNIQUE(scan_id, tag)
  "idx_user_badges_user", // PRIMARY KEY (user_id, badge_id)
  "idx_rate_limits_key", // UNIQUE(key, window_start)
  "idx_device_trust_user_id", // UNIQUE(user_id, device_fingerprint)
  "idx_team_members_team", // UNIQUE(team_id, user_id)
  "idx_domains_user_id", // UNIQUE(user_id, domain)
  "idx_api_keys_key_locator_backfill", // partial subset of idx_api_keys_key_locator
  // Found by tests/scripts/migrate/redundant-indexes.test.ts rather than by
  // the audit: the UNIQUE (message_id, user_id) index on broadcast_recipients
  // leads with message_id, and its own comment already says it "doubles as the
  // composite read index".
  "idx_broadcast_recipients_message",
  // UNIQUE(user_id) caps staff_activity at one row per user, so the second
  // column of (user_id, last_heartbeat) can never narrow anything.
  "idx_staff_activity_user_heartbeat",
];

/**
 * Columns that point at users(id) with no ON DELETE clause, which means ON
 * DELETE NO ACTION: deleting a user any of them references fails the whole
 * erasure transaction. lib/auth/account-deletion.ts nulls all four by hand
 * before its DELETE FROM users, so the documented delete paths work, but any
 * other path that removes a user (a repair script, hand-run SQL, a future code
 * path that forgets) still hits the violation. ON DELETE SET NULL puts the
 * guarantee in the database instead. ref: AUDIT-013#schema-03
 */
export const NON_CASCADING_FOREIGN_KEYS = [
  { table: "sessions", column: "impersonated_by" },
  { table: "security_alerts", column: "resolved_by" },
  { table: "system_settings", column: "updated_by" },
  { table: "broadcast_messages", column: "sent_by" },
];

/**
 * CHECK coverage was inverted relative to importance: a dozen cosmetic columns
 * had one and the five that carry authorization or money semantics did not.
 * The concrete consequence is in lib/database/cleanup.ts, whose per-plan scan
 * retention matches the four known plan literals and silently retains forever
 * anything else, and in lib/rate-limiting/daily-limits.ts, which casts the
 * column value straight to PlanType with no membership check.
 * ref: AUDIT-013#schema-07
 *
 * Added NOT VALID: the constraint is enforced for every INSERT and UPDATE from
 * now on, but existing rows are not scanned, so a database that already holds
 * an unexpected value keeps booting instead of failing where nobody can fix
 * it. Run `ALTER TABLE ... VALIDATE CONSTRAINT ...` by hand once the data is
 * known good.
 */
export const VALUE_SET_CHECKS = [
  {
    table: "users",
    name: "users_role_check",
    expr: "role IN ('user', 'beta_tester', 'super_admin', 'admin', 'moderator', 'support', 'billing', 'security_analyst', 'content_manager', 'ops')",
  },
  {
    table: "users",
    name: "users_plan_check",
    expr: "plan IN ('free', 'core_supporter', 'pro_supporter', 'elite_supporter')",
  },
  {
    table: "gifted_subscriptions",
    name: "gifted_subscriptions_plan_check",
    expr: "plan IN ('free', 'core_supporter', 'pro_supporter', 'elite_supporter')",
  },
  {
    table: "team_members",
    name: "team_members_role_check",
    expr: "role IN ('owner', 'admin', 'manager', 'operator', 'member', 'viewer')",
  },
  {
    table: "team_invites",
    name: "team_invites_role_check",
    expr: "role IN ('owner', 'admin', 'manager', 'operator', 'member', 'viewer')",
  },
  {
    table: "domains",
    name: "domains_status_check",
    expr: "status IN ('pending', 'verified', 'reverify_failed')",
  },
];

/**
 * Tables that get the BEFORE UPDATE updated_at trigger. ref: AUDIT-013#schema-10
 *
 * users.updated_at is handed to the user as the account's last-modified
 * timestamp by both GDPR export paths, while roughly two dozen UPDATE
 * statements never set it: every role change, the whole 2FA lifecycle, account
 * suspend/unsuspend, OAuth link and unlink, and every privacy toggle. Auditing
 * two dozen call sites (and every future one) is the wrong shape of fix; one
 * trigger per table makes the column true by construction.
 *
 * Each step is guarded on the column actually existing, so adding a table to
 * this list cannot break a boot.
 */
export const UPDATED_AT_TABLES = [
  "users",
  "notification_preferences",
  "discord_connections",
  "github_connections",
  "user_ai_configs",
  "staff_activity",
  "support_tickets",
];

/** @type {import("./index.mjs").SchemaStep[]} */
export const constraintSchemaSteps = [
  // DROP INDEX CONCURRENTLY, one statement per step: it cannot run inside a
  // transaction block and cannot name more than one index, so a single
  // multi-statement query string would fail on both counts. It takes no ACCESS
  // EXCLUSIVE lock, so a self-hoster with a large scan_history does not have
  // the table locked out at boot. Each drop is independently non-fatal: one
  // failure (an install created by an older path that never had the index, a
  // permissions problem) must not stop the rest, and none of them is required
  // for correctness.
  ...REDUNDANT_INDEXES.map((name) => ({
    id: `drop-redundant-${name}`,
    onError: /** @type {const} */ ("warn"),
    warning: `Failed to drop redundant index ${name}`,
    sql: `DROP INDEX CONCURRENTLY IF EXISTS ${name}`,
  })),

  // Idempotent by name: the constraint is dropped by name and re-added, and
  // the names are this schema's own, not PostgreSQL's auto-generated ones, so
  // a re-run is a no-op in effect. The guard keeps a boot from taking an
  // ACCESS EXCLUSIVE lock on every restart.
  ...NON_CASCADING_FOREIGN_KEYS.map((fk) => ({
    id: `fk-${fk.table}-${fk.column}`,
    onError: /** @type {const} */ ("warn"),
    warning: `Failed to migrate ${fk.table}.${fk.column} to ON DELETE SET NULL`,
    guard: {
      sql: `SELECT EXISTS (
               SELECT 1 FROM information_schema.table_constraints
               WHERE table_name = $1 AND constraint_name = $2
             ) AS exists`,
      params: [fk.table, `fk_${fk.table}_${fk.column}`],
    },
    notice: `[security-migration] ${fk.table}.${fk.column} -> users(id) is now ON DELETE SET NULL`,
    sql: [
      `ALTER TABLE ${fk.table}
               DROP CONSTRAINT IF EXISTS ${fk.table}_${fk.column}_fkey`,
      `ALTER TABLE ${fk.table}
               ADD CONSTRAINT fk_${fk.table}_${fk.column}
               FOREIGN KEY (${fk.column})
               REFERENCES users(id) ON DELETE SET NULL`,
    ],
  })),

  // Guarded on the constraint name so a boot is a no-op rather than an ACCESS
  // EXCLUSIVE lock every restart.
  ...VALUE_SET_CHECKS.map((chk) => ({
    id: `check-${chk.name}`,
    onError: /** @type {const} */ ("warn"),
    warning: `Failed to add ${chk.name}`,
    guard: {
      sql: `SELECT EXISTS (
               SELECT 1 FROM pg_constraint WHERE conname = $1
             ) AS exists`,
      params: [chk.name],
    },
    sql: `ALTER TABLE ${chk.table} ADD CONSTRAINT ${chk.name} CHECK (${chk.expr}) NOT VALID`,
  })),

  {
    id: "updated-at-function",
    onError: /** @type {const} */ ("warn"),
    warning: "Failed to create vulnradar_set_updated_at",
    sql: `
        CREATE OR REPLACE FUNCTION vulnradar_set_updated_at()
        RETURNS trigger AS $fn$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $fn$ LANGUAGE plpgsql;
      `,
  },

  ...UPDATED_AT_TABLES.map((table) => ({
    id: `updated-at-trigger-${table}`,
    onError: /** @type {const} */ ("warn"),
    warning: `Failed to attach updated_at trigger to ${table}`,
    guard: {
      sql: `SELECT EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = $1 AND column_name = 'updated_at'
             ) AS exists`,
      params: [table],
      runWhen: true,
    },
    sql: [
      `DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table}`,
      `CREATE TRIGGER trg_${table}_updated_at
               BEFORE UPDATE ON ${table}
               FOR EACH ROW EXECUTE FUNCTION vulnradar_set_updated_at()`,
    ],
  })),
];
