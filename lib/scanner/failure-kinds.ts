/**
 * Why a scan ended `failed`, stored in scan_history.failure_kind.
 *
 * `failed` was the only terminal non-success state, so a scan the user
 * cancelled, a bulk URL a quota refused before it ran, a target that was
 * simply down and a genuine engine crash all looked identical. Every health
 * number built on that row counted all four as engine failures, and the admin
 * queue reported a user pressing Cancel as an outage.
 *
 * The status stays `failed` (owner decision 5: a column, not a new status, so
 * no CHECK constraint and no `status = 'failed'` consumer changes). This is the
 * reason beside it. Rows written before the column existed are classified once
 * from their error_message by the boot backfill in
 * lib/database/schema/02-features.mjs.
 *
 * The SQL CHECK restates this list in three places that cannot import
 * TypeScript (the boot ALTER, VALUE_SET_CHECKS and the migration's
 * addColumns). tests/lib/scanner/failure-kinds.test.ts fails if any of them
 * drifts from this array, so change it here first.
 */
export const FAILURE_KINDS = [
  /** The owner pressed Cancel. */
  "cancelled",
  /** Staff cancelled it from the admin queue. */
  "admin_cancelled",
  /** A daily or API-key limit refused it. Nothing was attempted. */
  "quota_refused",
  /** Part of a bulk batch that stopped before reaching this URL. */
  "not_run",
  /** The process restarted while it ran (the boot-time stale sweep). */
  "interrupted",
  /** It stopped reporting progress and the periodic sweep closed it. */
  "stale",
  /** It ran past its watchdog budget. */
  "timeout",
  /** The target refused or reset the connection, or did not resolve. */
  "target_unreachable",
  /** The target accepted the connection and then did not answer in time. */
  "target_timeout",
  /** The target's TLS certificate or handshake failed. */
  "target_tls",
  /** The target redirected to a different host, which is not followed. */
  "target_redirect_offhost",
  /** The target resolved to an address the SSRF guard refuses. */
  "target_blocked",
  /** Anything else: the engine itself failed. The default. */
  "internal",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

/**
 * The kinds that mean the scanner broke, as opposed to the user, a quota or
 * the target. Only these count toward a health failure rate: a cancel or a
 * down target is the product working, and counting them is how a busy day
 * looked like an incident.
 */
export const ENGINE_FAILURE_KINDS = [
  "internal",
  "interrupted",
  "stale",
  "timeout",
] as const satisfies readonly FailureKind[];

export type EngineFailureKind = (typeof ENGINE_FAILURE_KINDS)[number];

/** Short admin-facing names, for the queue and health views. */
export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  cancelled: "Cancelled by the user",
  admin_cancelled: "Cancelled by staff",
  quota_refused: "Refused by a limit",
  not_run: "Never ran",
  interrupted: "Interrupted by a restart",
  stale: "Stopped responding",
  timeout: "Ran out of time",
  target_unreachable: "Target unreachable",
  target_timeout: "Target did not respond",
  target_tls: "Target TLS failed",
  target_redirect_offhost: "Redirected to another host",
  target_blocked: "Target address blocked",
  internal: "Internal error",
};

const KNOWN = new Set<string>(FAILURE_KINDS);
const ENGINE = new Set<string>(ENGINE_FAILURE_KINDS);

/** Narrow a value read from the database or a request body. */
export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && KNOWN.has(value);
}

/**
 * Whether a failed row counts against engine health. A NULL kind counts: it
 * is a row the backfill has not reached yet, and undercounting real failures
 * is the worse mistake for a health check.
 */
export function isEngineFailure(kind: string | null | undefined): boolean {
  return kind == null || ENGINE.has(kind);
}
