/**
 * Tables the app's core request paths (auth, scanning, API keys, billing)
 * cannot function without. Used by /api/v3/health to catch the case
 * instrumentation.ts's own boot-time CREATE TABLE sequence is built to
 * survive: a single table's create/alter statement failing (a transient DB
 * hiccup mid-sequence, a permissions issue) only ever console.errors and
 * continues, so schema_version can say "ready" while a table it depends on
 * doesn't actually exist yet (AUDIT-010, production-readiness #3).
 *
 * Deliberately a representative core set, not the full ~30-table schema --
 * exhaustive tracking would drift out of sync with instrumentation.ts on
 * every new table. Add an entry here when a new table becomes load-bearing
 * for a core path (a request 500ing without it), not for every table.
 */
export const REQUIRED_TABLES = [
  "users",
  "scan_history",
  "api_keys",
  "host_reputation",
  "host_badges",
  "webhooks",
  "scan_finding_feedback",
  "system_error_logs",
] as const;
