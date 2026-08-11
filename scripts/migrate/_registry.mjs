/**
 * VulnRadar — Schema version registry.
 *
 * Single source of truth for every known schema version and its fingerprint.
 * "Fingerprint" is a set of tables + columns that uniquely identify the
 * version. The migrator uses it both for:
 *   - Detecting the current version when no meta table exists.
 *   - Verifying a target version was reached after a migration.
 *
 * Adding a new version:
 *   1. Bump `version` in `package.json`.
 *   2. Add an entry to VERSIONS with a fingerprint (and expectedColumns
 *      for ambiguous tables).
 *   3. Create a `versions/<prev>-to-<new>.mjs` file with the diff.
 *   4. The runner will pick it up automatically.
 *
 * Adding a downgrade from a higher version that's never been released:
 *   Just create the file. The registry doesn't care about direction.
 *
 * Note on app version vs schema version:
 *   App 2.3.0 ran against schema v2 (api_keys.key_locator was the only
 *   difference, auto-applied on boot). App 3.0.0 introduces schema v3.0.0,
 *   a squashed migration carrying the net effect of an entire unreleased
 *   development tail (previously numbered 3.0.0 through 5.9.0) — see
 *   scripts/migrate/versions/2.0.0-to-3.0.0.mjs. Schema v3.0.0 no longer
 *   includes users.email_prefs -- notification preferences are managed by
 *   the notification_preferences table.
 *   getRecommendedVersion falls back to the highest registry entry when the
 *   exact app version isn't registered.
 */

import { readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERSIONS_DIR = resolve(__dirname, "versions");

/**
 * Schema versions VulnRadar knows about. Ordered oldest → newest.
 *
 * Fingerprint = { tables: Set<string>, columns: { [table]: Set<string> } }
 *
 * The migrator picks the highest version whose fingerprint is a strict
 * superset of the live schema. (Strict superset so v2 isn't matched as
 * v2.3.0 just because v2.3.0 has v2's tables plus more.)
 */
export const VERSIONS = [
  {
    name: "1.0.0",
    label: "v1 baseline (pre-MVP, 19 tables)",
    fingerprint: {
      tables: new Set([
        "users",
        "sessions",
        "api_keys",
        "api_usage",
        "scan_history",
        "scan_tags",
        "webhooks",
        "scheduled_scans",
        "data_requests",
        "admin_audit_log",
        "password_reset_tokens",
        "email_verification_tokens",
        "notification_preferences",
        "email_2fa_codes",
        "rate_limits",
        "device_trust",
        "teams",
        "team_members",
        "team_invites",
      ]),
      columns: {
        users: new Set([
          "id",
          "email",
          "password_hash",
          "name",
          "role",
          "avatar_url",
          "tos_accepted_at",
          "email_verified_at",
          "disabled_at",
          "onboarding_completed",
          "totp_secret",
          "totp_enabled",
          "two_factor_method",
          "backup_codes",
          "created_at",
          "updated_at",
        ]),
        api_keys: new Set([
          "id",
          "user_id",
          "key_hash",
          "key_prefix",
          "name",
          "created_at",
          "last_used_at",
          "revoked_at",
        ]),
      },
    },
  },
  {
    name: "2.0.0",
    label: "v2 / production schema (34 tables)",
    fingerprint: {
      // v2 = the current production schema. v2.3.0 is the same schema
      // (only difference is api_keys.key_locator, which instrumentation.ts
      // auto-applies on boot). So a v2 DB and a v2.3.0 DB both match this
      // fingerprint.
      tables: new Set([
        // v1 core (19)
        "users",
        "sessions",
        "api_keys",
        "api_usage",
        "scan_history",
        "scan_tags",
        "webhooks",
        "scheduled_scans",
        "data_requests",
        "admin_audit_log",
        "password_reset_tokens",
        "email_verification_tokens",
        "notification_preferences",
        "email_2fa_codes",
        "rate_limits",
        "device_trust",
        "teams",
        "team_members",
        "team_invites",
        // v2 tables
        "billing_history",
        "access_rules",
        "admin_notifications",
        "admin_user_notes",
        "badges",
        "billing_verification_codes",
        "broadcast_messages",
        "broadcast_recipients",
        "discord_connections",
        "gifted_subscriptions",
        "security_alerts",
        "staff_activity",
        "subdomain_cache",
        "system_settings",
        "user_badges",
      ]),
      columns: {
        users: new Set([
          "id",
          "email",
          "password_hash",
          "name",
          "role",
          "avatar_url",
          "discord_id",
          "plan",
          "stripe_customer_id",
          "stripe_subscription_id",
          "subscription_status",
          "current_period_end",
          "cancel_at_period_end",
          "beta_access",
          "daily_scan_limit",
          "email_verified_at",
          "tos_accepted_at",
          "disabled_at",
          "onboarding_completed",
          "totp_secret",
          "totp_enabled",
          "two_factor_method",
          "backup_codes",
          "email_session_revoked",
          "created_at",
          "updated_at",
        ]),
        api_keys: new Set([
          "id",
          "user_id",
          "key_hash",
          "key_locator",
          "key_encrypted",
          "key_prefix",
          "name",
          "daily_limit",
          "created_at",
          "last_used_at",
          "revoked_at",
        ]),
      },
    },
  },
  {
    name: "3.0.0",
    label: "v3.0 / production schema (46 tables)",
    // Squashed target: this used to be reached via nine intermediate
    // schema versions (3.0.0 through 5.9.0 under the old numbering), none
    // of which ever ran in production. This fingerprint is the exact NET
    // shape of that whole unreleased tail, collapsed into a single
    // upgrade step from v2.0.0. See
    // scripts/migrate/versions/2.0.0-to-3.0.0.mjs for the full
    // itemized history of what each table/column used to be called.
    //
    // Notably absent: `scan_credentials` and `scan_history.credential_id`
    // (the old v5.0.0 credential vault) — that table was added and then
    // fully removed later in the same unreleased tail (ephemeral
    // authenticated scanning replaced it), so it never reaches this
    // fingerprint.
    fingerprint: {
      tables: new Set([
        // v1 core (19)
        "users",
        "sessions",
        "api_keys",
        "api_usage",
        "scan_history",
        "scan_tags",
        "webhooks",
        "scheduled_scans",
        "data_requests",
        "admin_audit_log",
        "password_reset_tokens",
        "email_verification_tokens",
        "notification_preferences",
        "email_2fa_codes",
        "rate_limits",
        "device_trust",
        "teams",
        "team_members",
        "team_invites",
        // v2 tables (15)
        "billing_history",
        "access_rules",
        "admin_notifications",
        "admin_user_notes",
        "badges",
        "billing_verification_codes",
        "broadcast_messages",
        "broadcast_recipients",
        "discord_connections",
        "gifted_subscriptions",
        "security_alerts",
        "staff_activity",
        "subdomain_cache",
        "system_settings",
        "user_badges",
        // v3.0.0 additions (7 original + 4 added by AUDIT-009 migration-01)
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
        // Unified AI usage tracking (chat/verify/summary), folded into this
        // same squashed step for the same reason the AUDIT-009 additions
        // above were -- see scripts/migrate/versions/2.0.0-to-3.0.0.mjs's
        // header comment.
        "ai_usage",
        // System error log capture (Admin > System > Error Logs), folded
        // into this same squashed step for the same reason.
        "system_error_logs",
        // Auto tag dismissals (Admin > Engine Feedback's per-auto-tag-rule
        // dismissal rate), folded into this same squashed step for the
        // same reason -- see scripts/migrate/versions/2.0.0-to-3.0.0.mjs's
        // header comment.
        "auto_tag_dismissals",
        // Admin-promoted auto-tag rules (Admin > Engine Feedback > AI Tag
        // Candidates -> "Promote"), folded into this same squashed step
        // for the same reason.
        "promoted_auto_tag_rules",
        // AI credit purchase idempotency ledger, keyed by Stripe
        // PaymentIntent id -- folded into this same squashed step for the
        // same reason. See scripts/migrate/versions/2.0.0-to-3.0.0.mjs's
        // header comment.
        "ai_credit_purchases",
      ]),
      columns: {
        users: new Set([
          "id",
          "email",
          "password_hash",
          "name",
          "role",
          "avatar_url",
          "discord_id",
          "plan",
          "stripe_customer_id",
          "stripe_subscription_id",
          "subscription_status",
          "current_period_end",
          "cancel_at_period_end",
          "beta_access",
          "daily_scan_limit",
          "email_verified_at",
          "tos_accepted_at",
          "disabled_at",
          "onboarding_completed",
          "totp_secret",
          "totp_enabled",
          "two_factor_method",
          "backup_codes",
          "email_session_revoked",
          // v3.0.0 additions
          "unsubscribe_token",
          "totp_last_counter",
          "auth_provider",
          // v3.0.0 additions added by AUDIT-009 migration-01
          "ai_chat_banned",
          "google_id",
          "google_email",
          "google_name",
          "google_avatar_url",
          "github_id",
          "github_email",
          "github_name",
          "github_avatar_url",
          "discord_username",
          "discord_avatar_url",
          "discord_email",
          "scans_private_by_default",
          // Public Scans directory (independent of scans_private_by_default
          // / is_public -- see scripts/migrate/versions/2.0.0-to-3.0.0.mjs's
          // header comment).
          "share_publicly_listed_by_default",
          // Staff plan grant/revoke -- see scripts/migrate/versions/
          // 2.0.0-to-3.0.0.mjs's header comment.
          "pre_staff_plan",
          // One-time AI credit purchases -- see scripts/migrate/versions/
          // 2.0.0-to-3.0.0.mjs's header comment.
          "ai_credit_balance",
          // Free-plan daily GitHub AI review trial -- see
          // scripts/migrate/versions/2.0.0-to-3.0.0.mjs's header comment.
          "free_github_review_used_at",
          "created_at",
          "updated_at",
        ]),
        api_keys: new Set([
          "id",
          "user_id",
          "key_hash",
          "key_locator",
          "key_encrypted",
          "key_prefix",
          "name",
          "daily_limit",
          "created_at",
          "last_used_at",
          "revoked_at",
          "bound_ip",
          // AUDIT-009 migration-01
          "scopes",
        ]),
        scan_history: new Set([
          "share_token_hash",
          "authenticated",
          "status",
          "current_category",
          "categories_completed",
          "categories_total",
          "started_at",
          "error_message",
          "result_meta",
          "scan_type",
          // AUDIT-009 migration-01
          "share_expires_at",
          "is_public",
          // Public Scans directory
          "share_publicly_listed",
        ]),
        host_reputation: new Set([
          "host",
          "danger_score",
          "severity_counts",
          "last_scanned_at",
          "source_scan_id",
          // AUDIT-009 migration-01
          "findings",
          "response_headers",
          "result_meta",
          "authenticated",
          "scanned_url",
        ]),
        github_connections: new Set([
          "id",
          "user_id",
          "github_user_id",
          "github_username",
          "access_token_encrypted",
          "scopes",
          "connected_at",
          "updated_at",
          "selected_repos",
        ]),
        github_review_usage: new Set([
          "id",
          "user_id",
          "window_start",
          "tokens_used",
          "updated_at",
        ]),
        // AUDIT-009 migration-01
        processed_stripe_events: new Set([
          "event_id",
          "event_type",
          "processed_at",
        ]),
        user_ai_configs: new Set([
          "id",
          "user_id",
          "use_vulnradar_ai",
          "provider",
          "model_id",
          "api_key_encrypted",
          "base_url",
          "ai_disabled",
          "created_at",
          "updated_at",
        ]),
        cve_kev_cache: new Set(["cache_key", "cve_ids", "cached_at"]),
        webhook_deliveries: new Set([
          "id",
          "webhook_id",
          "event_type",
          "http_status",
          "response_snippet",
          "attempted_at",
        ]),
        ai_usage: new Set([
          "user_id",
          "window_start",
          "tokens_used",
          "updated_at",
        ]),
        system_error_logs: new Set(["id", "message", "detail", "created_at"]),
        auto_tag_dismissals: new Set([
          "id",
          "scan_id",
          "tag",
          "dismissed_by_user_id",
          "dismissed_at",
        ]),
        promoted_auto_tag_rules: new Set([
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
        ai_credit_purchases: new Set([
          "payment_intent_id",
          "user_id",
          "tokens",
          "credited_at",
        ]),
        // Auto tags (lib/tags/auto-tags.ts) -- see
        // scripts/migrate/versions/2.0.0-to-3.0.0.mjs's header comment.
        scan_tags: new Set(["source"]),
        broadcast_messages: new Set(["sent_by"]),
        scheduled_scans: new Set([
          "preferred_hour_utc",
          "preferred_day_of_week",
          "preferred_day_of_month",
        ]),
        webhooks: new Set(["secret"]),
      },
    },
  },
];

/**
 * Order two versions, returning -1/0/1.
 */
export function compareVersions(a, b) {
  const ai = VERSIONS.findIndex((v) => v.name === a);
  const bi = VERSIONS.findIndex((v) => v.name === b);
  if (ai === -1 || bi === -1) {
    throw new Error(
      `Unknown version: ${ai === -1 ? a : b}. Known: ${VERSIONS.map((v) => v.name).join(", ")}`,
    );
  }
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

export function getVersion(name) {
  const v = VERSIONS.find((v) => v.name === name);
  if (!v) {
    throw new Error(
      `Unknown version: ${name}. Known: ${VERSIONS.map((v) => v.name).join(", ")}`,
    );
  }
  return v;
}

/**
 * The version that the running app is built against. Looks for an exact
 * match against the registry; falls back to the highest known version
 * (which is what an app version newer than the registry should resolve
 * to).
 *
 * v2.3.0 is intentionally NOT in the registry — it's the same schema
 * as v2, just with one auto-applied column. So getRecommendedVersion
 * returns v2 for an app version of 2.3.0.
 */
export function getRecommendedVersion(appVersion) {
  const exact = VERSIONS.find((v) => v.name === appVersion);
  if (exact) return exact;
  return VERSIONS[VERSIONS.length - 1];
}

export function isUpgrade(from, to) {
  return compareVersions(to, from) > 0;
}

export function isDowngrade(from, to) {
  return compareVersions(to, from) < 0;
}

/**
 * Returns the ordered list of version transitions needed to go from `from`
 * to `to`. Each step is { from, to, file } where `file` is the path to the
 * version module to import.
 *
 * Example: transitions("1.0.0", "2.3.0")
 *   → [
 *       { from: "1.0.0", to: "2.0.0", file: "1.0.0-to-2.0.0.mjs" },
 *       { from: "2.0.0", to: "2.3.0", file: "2.0.0-to-2.3.0.mjs" },
 *     ]
 */
export function transitions(from, to) {
  const fromIdx = VERSIONS.findIndex((v) => v.name === from);
  const toIdx = VERSIONS.findIndex((v) => v.name === to);
  if (fromIdx === -1) throw new Error(`Unknown version: ${from}`);
  if (toIdx === -1) throw new Error(`Unknown version: ${to}`);
  if (fromIdx === toIdx) return [];

  const steps = [];
  if (fromIdx < toIdx) {
    for (let i = fromIdx; i < toIdx; i++) {
      steps.push({
        from: VERSIONS[i].name,
        to: VERSIONS[i + 1].name,
        direction: "upgrade",
      });
    }
  } else {
    for (let i = fromIdx; i > toIdx; i--) {
      steps.push({
        from: VERSIONS[i].name,
        to: VERSIONS[i - 1].name,
        direction: "downgrade",
      });
    }
  }
  return steps;
}

/**
 * Find the right .mjs file in `versions/` for a given step. Filenames
 * are symmetric: a file named `2.0.0-to-2.3.0.mjs` handles BOTH the
 * 2.0.0→2.3.0 upgrade AND the 2.3.0→2.0.0 downgrade (the file exports
 * `upgrade` and `downgrade` separately). We try the canonical ordering
 * first, then the reversed one, so file authors can pick whichever feels
 * more natural.
 */
export function findVersionFile(step) {
  const a = step.from;
  const b = step.to;
  const candidates = [
    resolve(VERSIONS_DIR, `${a}-to-${b}.mjs`),
    resolve(VERSIONS_DIR, `${b}-to-${a}.mjs`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No version file found for ${a} ↔ ${b}. Expected one of:\n  - ${
      candidates[0]
    }\n  - ${candidates[1]}`,
  );
}

/**
 * List every version file actually present in `versions/`. Skips files
 * that start with `_` (those are shared helpers, not transitions).
 * Useful for startup diagnostics — if a file is missing for a
 * transition the registry predicts, the runner will fail with a clear
 * error.
 */
export function listVersionFiles() {
  return readdirSync(VERSIONS_DIR)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => !f.startsWith("_"));
}
