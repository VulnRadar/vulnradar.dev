/**
 * v2.0.0 → v1.0.0 — Reverse of the v1→v2 upgrade.
 *
 * This file is the down half of the v1↔v2 pair. v2.3.0 is intentionally
 * NOT in the registry (it's the same schema as v2), so a "v2.3.0 → v1"
 * downgrade composes no v2.3.0 step — just this one.
 *
 * DROPS the 15 v2 tables (billing + badges + admin + broadcast + ...) and
 * the v2-only columns on users + api_keys. ALL v2 data is lost.
 */

export const from = "2.0.0";
export const to = "1.0.0";

export const upgrade = {
  description: "(unused — v1 has no addTables that v2 doesn't already have)",
  addTables: [],
  addColumns: [],
};

export const downgrade = {
  description:
    "Drop 15 v2 tables and v2-only columns on users/api_keys. " +
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
