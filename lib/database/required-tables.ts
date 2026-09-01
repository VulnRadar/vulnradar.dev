/**
 * Tables the app's core request paths (auth, scanning, API keys, billing)
 * cannot function without. Used by /api/v3/health to catch the case the
 * boot-time schema (lib/database/schema) is built to survive: a step whose
 * onError is "warn" (a transient DB hiccup mid-sequence, a permissions issue)
 * only ever console.errors and continues, so schema_version can say "ready"
 * while a table it depends on doesn't actually exist yet (AUDIT-010,
 * production-readiness #3).
 *
 * Deliberately a representative core set, not the full ~66-table schema --
 * exhaustive tracking would drift out of sync with the schema on every new
 * table. Add an entry here when a new table becomes load-bearing for a core
 * path (a request 500ing without it), not for every table.
 *
 * That "representative" argument was doing too much work: the list omitted
 * `sessions`, which lib/auth/auth.ts reads on every authenticated request, so
 * /api/v3/health could report schema_ok with no missing tables while login,
 * logout and every dashboard route 500ed. The seven names added below are the
 * rest of that class: without them auth, rate limiting, signup or billing
 * idempotency is broken, and each is created inside a `.catch()` that only
 * console.errors, which is exactly the failure this list exists to catch.
 * ref: AUDIT-013#schema-06
 *
 * Only tables the boot sequence creates unconditionally belong here.
 * staff_invites and admin_audit_log_archive used to be excluded on the
 * grounds that they were created lazily on first use, so a fresh install
 * legitimately did not have them. That is no longer true: both are ordered
 * steps in lib/database/schema (their DDL lives in lib/admin/staff-invites.ts
 * and lib/database/audit-log-archive.ts, which the boot path calls), so their
 * absence is a real schema fault and health should say so.
 * ref: AUDIT-013#schema-02
 */
export const REQUIRED_TABLES = [
  "users",
  "sessions",
  "scan_history",
  "api_keys",
  "host_reputation",
  "host_badges",
  "webhooks",
  "scan_finding_feedback",
  "system_error_logs",
  "rate_limits",
  "notification_preferences",
  "processed_stripe_events",
  "ai_credit_purchases",
  "github_credit_purchases",
  "browserbase_credit_purchases",
  "staff_invites",
  "admin_audit_log_archive",
] as const;
