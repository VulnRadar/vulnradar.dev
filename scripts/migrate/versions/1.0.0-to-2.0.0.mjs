/**
 * v1.0.0 → v2.0.0 — Adds the current production schema.
 *
 * "v2" here is the current 34-table production schema. The app's
 * package.json is at 2.3.0 but the only schema difference between v2
 * and v2.3.0 is `api_keys.key_locator` (a single column), so the
 * framework tracks one version, not two.
 *
 * What this upgrade does:
 *   - Adds 15 new tables (billing + badges + admin + broadcast + ...).
 *   - Adds 8 columns to `users` for Stripe subscription tracking +
 *     Discord linking + 2FA revocation tracking.
 *   - Adds `key_encrypted`, `daily_limit`, AND `key_locator` to `api_keys`
 *     (key_locator is the v2.3.0-specific column — included here so a
 *     v1 DB migrating to v2 ends up on the current production schema).
 *   - Adds a backfill index on `api_keys.key_locator`.
 *
 * Note: instrumentation.ts auto-creates the 15 new tables and the
 * key_locator column on app boot, so this migration is mostly for
 * the case where someone wants to use the script rather than boot
 * the app. Both paths arrive at the same final state.
 *
 * Reversible: see the `downgrade` export. Downgrading DROPS the 15
 * tables and the v2-only columns, which deletes data — explicit
 * "yes" required.
 */

import { V2_NEW_TABLES } from "./_snippets.mjs";

export const from = "1.0.0";
export const to = "2.0.0";

export const upgrade = {
  description:
    "Add the 15 v2 tables (billing + badges + admin + broadcast + ...) " +
    "+ Stripe-related columns on users + key_encrypted + daily_limit + key_locator on api_keys.",

  addTables: [
    { name: "access_rules", sql: V2_NEW_TABLES.access_rules },
    { name: "admin_notifications", sql: V2_NEW_TABLES.admin_notifications },
    { name: "admin_user_notes", sql: V2_NEW_TABLES.admin_user_notes },
    { name: "badges", sql: V2_NEW_TABLES.badges },
    { name: "user_badges", sql: V2_NEW_TABLES.user_badges },
    { name: "billing_history", sql: V2_NEW_TABLES.billing_history },
    {
      name: "billing_verification_codes",
      sql: V2_NEW_TABLES.billing_verification_codes,
    },
    { name: "broadcast_messages", sql: V2_NEW_TABLES.broadcast_messages },
    { name: "broadcast_recipients", sql: V2_NEW_TABLES.broadcast_recipients },
    { name: "discord_connections", sql: V2_NEW_TABLES.discord_connections },
    {
      name: "gifted_subscriptions",
      sql: V2_NEW_TABLES.gifted_subscriptions,
    },
    { name: "security_alerts", sql: V2_NEW_TABLES.security_alerts },
    { name: "staff_activity", sql: V2_NEW_TABLES.staff_activity },
    { name: "subdomain_cache", sql: V2_NEW_TABLES.subdomain_cache },
    { name: "system_settings", sql: V2_NEW_TABLES.system_settings },
  ],

  addColumns: [
    {
      table: "users",
      column: "plan",
      definition: "VARCHAR(50) DEFAULT 'free'",
    },
    {
      table: "users",
      column: "stripe_customer_id",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "stripe_subscription_id",
      definition: "VARCHAR(255)",
    },
    {
      table: "users",
      column: "subscription_status",
      definition: "VARCHAR(50) DEFAULT NULL",
    },
    {
      table: "users",
      column: "current_period_end",
      definition: "TIMESTAMP WITH TIME ZONE",
    },
    {
      table: "users",
      column: "cancel_at_period_end",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    {
      table: "users",
      column: "beta_access",
      definition: "BOOLEAN DEFAULT FALSE",
    },
    {
      table: "users",
      column: "daily_scan_limit",
      definition: "INTEGER DEFAULT NULL",
    },
    {
      table: "users",
      column: "email_session_revoked",
      definition: "BOOLEAN NOT NULL DEFAULT false",
    },
    { table: "users", column: "discord_id", definition: "VARCHAR(64) UNIQUE" },
    {
      table: "api_keys",
      column: "daily_limit",
      definition: "INTEGER DEFAULT 50",
    },
    { table: "api_keys", column: "key_encrypted", definition: "TEXT" },
    // The v2.3.0-specific column. instrumentation.ts auto-adds this on
    // app boot, but we include it here so a v1 DB migrated via the
    // script ends up on the current production schema.
    { table: "api_keys", column: "key_locator", definition: "VARCHAR(32)" },
  ],

  addIndexes: [
    {
      name: "idx_api_keys_key_locator",
      table: "api_keys",
      columns: "key_locator",
    },
    {
      name: "idx_api_keys_key_locator_backfill",
      table: "api_keys",
      columns: "key_locator",
      where: "key_locator IS NULL",
    },
  ],
};

export const downgrade = {
  description:
    "Drop the 15 v2 tables and v2-only columns from users and api_keys. " +
    "DELETES all billing, badge, broadcast, and admin data.",

  dropTables: [
    "system_settings",
    "subdomain_cache",
    "staff_activity",
    "security_alerts",
    "gifted_subscriptions",
    "discord_connections",
    "broadcast_recipients",
    "broadcast_messages",
    "billing_verification_codes",
    "user_badges",
    "badges",
    "admin_user_notes",
    "admin_notifications",
    "access_rules",
    "billing_history",
  ],

  dropColumns: [
    { table: "users", column: "plan" },
    { table: "users", column: "stripe_customer_id" },
    { table: "users", column: "stripe_subscription_id" },
    { table: "users", column: "subscription_status" },
    { table: "users", column: "current_period_end" },
    { table: "users", column: "cancel_at_period_end" },
    { table: "users", column: "beta_access" },
    { table: "users", column: "daily_scan_limit" },
    { table: "users", column: "email_session_revoked" },
    { table: "users", column: "discord_id" },
    { table: "api_keys", column: "daily_limit" },
    { table: "api_keys", column: "key_encrypted" },
    { table: "api_keys", column: "key_locator" },
  ],
};
