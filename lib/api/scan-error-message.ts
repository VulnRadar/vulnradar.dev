/**
 * Turn a stored `scan_history.error_message` into something safe to show the
 * person who ran the scan.
 *
 * The scan pipeline catches ANY throw and persists `error.message` verbatim
 * (lib/scanner/execute-scan.ts, lib/scanner/execute-crawl-scan.ts,
 * app/api/v3/scan/route.ts's dispatch catch), so the column can hold a pg
 * driver string naming an internal table, a Node socket error naming a
 * private IP and port, or a library stack message. The scan status endpoint
 * returned that string unchanged and the dashboard renders it in a monospace
 * block next to a "Copy error details" button, which made every internal
 * failure an infrastructure disclosure.
 *
 * Sanitizing HERE, at the read boundary, covers every producer at once,
 * including the background workers. The raw string stays in the row and in
 * the server logs, which is where an operator debugging the failure should
 * be looking anyway.
 *
 * The row also carries a `failure_kind` (lib/scanner/failure-kinds.ts), and
 * that is what this should be reading. Classifying free text after the fact
 * got the two big groups backwards: a target problem fell through to "an
 * internal error", and a database problem whose message said "timeout" or
 * "ECONNREFUSED" was reported as the target's fault. The kind is recorded at
 * the throw site, where the truth is known, so it decides first; the text
 * classifiers below only serve rows that have no kind (older rows, and callers
 * that pass none).
 */

import type { FailureKind } from "@/lib/scanner/failure-kinds";
import { isFailureKind } from "@/lib/scanner/failure-kinds";
import {
  API_KEY_LIMIT_MESSAGE,
  BULK_STOPPED_MESSAGE,
  DAILY_LIMIT_MESSAGE,
  SCAN_ADMIN_CANCELLED_MESSAGE,
  SCAN_CANCELLED_MESSAGE,
  SCAN_INTERRUPTED_MESSAGE,
  SCAN_STALE_MESSAGE,
} from "@/lib/scanner/failure-messages";

/** What every unrecognised message collapses to. */
export const GENERIC_SCAN_ERROR =
  "The scan could not be completed because of an internal error. Please try again.";

/** Messages the pipeline writes deliberately, for the user, and that carry
 *  nothing but their own fixed wording. Passed through unchanged. */
const USER_FACING_EXACT = new Set([
  SCAN_CANCELLED_MESSAGE,
  SCAN_ADMIN_CANCELLED_MESSAGE,
  SCAN_INTERRUPTED_MESSAGE,
  SCAN_STALE_MESSAGE,
  DAILY_LIMIT_MESSAGE,
  API_KEY_LIMIT_MESSAGE,
  BULK_STOPPED_MESSAGE,
  "Scan failed to start.",
  "An unexpected error occurred during the scan.",
  "An unexpected error occurred during the crawl scan.",
]);

/** Same, for the messages that interpolate a configured timeout. */
const USER_FACING_PATTERNS = [
  /^Scan exceeded the \d+s time limit\.$/,
  /^Crawl scan exceeded the \d+s time limit\.$/,
  /^Bulk scan batch exceeded its \d+s time limit before this URL ran\.$/,
];

/**
 * One fixed sentence per failure kind, for the person who ran the scan.
 * Nothing from the raw message is interpolated, so a host, IP or port never
 * reaches the response through here.
 *
 * `cancelled` and `interrupted` are the same strings the pipeline stores, so
 * a dashboard that compares against them keeps working.
 */
const KIND_MESSAGES: Record<FailureKind, string> = {
  cancelled: SCAN_CANCELLED_MESSAGE,
  admin_cancelled: SCAN_ADMIN_CANCELLED_MESSAGE,
  quota_refused:
    "This scan did not run because a daily scan limit was reached. Nothing was scanned.",
  not_run:
    "This scan did not run: the batch it belonged to stopped before reaching it.",
  interrupted: SCAN_INTERRUPTED_MESSAGE,
  stale: SCAN_STALE_MESSAGE,
  timeout: "The scan ran past its time limit and was stopped.",
  target_unreachable:
    "The target could not be reached: the hostname did not resolve, or the connection was refused or closed early.",
  target_timeout: "The target did not respond in time.",
  target_tls: "The target's TLS certificate could not be validated.",
  target_redirect_offhost:
    "The target redirected to a different host, which the scanner does not follow. Scan the address it redirects to instead.",
  target_blocked:
    "The target resolves to an address the scanner is not allowed to reach.",
  internal: GENERIC_SCAN_ERROR,
};

/**
 * The sentence for a failure kind. Exported so the "page could not be
 * fetched" marker on a completed scan (lib/scanner/target-failure.ts) says
 * the same thing a failed scan of the same cause would.
 */
export function failureKindMessage(kind: FailureKind): string {
  return KIND_MESSAGES[kind];
}

/**
 * Messages that come from the database layer, not from the target. These are
 * checked BEFORE the transport classifiers because they share their words:
 * pg-pool's "timeout exceeded when trying to connect" reads as a target
 * timeout, and a refused connection to Postgres reads as a refused connection
 * to the target. Telling a user their site did not respond when it was our own
 * pool that ran dry sends them chasing the wrong machine.
 */
const DATABASE_FAILURES: RegExp[] = [
  /timeout exceeded when trying to connect/i,
  /connection terminated/i,
  /canceling statement due to (?:statement|lock) timeout/i,
  /too many clients already|remaining connection slots/i,
  /the database system is (?:starting up|shutting down|in recovery)/i,
  /deadlock detected/i,
  /current transaction is aborted/i,
  /violates (?:foreign key|unique|check|not-null) constraint|duplicate key value/i,
  /(?:relation|column|function|schema) "[^"]*" (?:\S+ )*does not exist/i,
  /invalid input syntax for type|syntax error at or near/i,
];

/**
 * Coarse classification of the common transport failures, for rows that
 * carry no kind. Each branch maps to a FIXED sentence: nothing from the raw
 * message is interpolated, so the host, IP and port an error like
 * `connect ECONNREFUSED 10.0.0.5:5432` carries never reach the response.
 */
const CLASSIFIERS: { test: RegExp; message: string }[] = [
  {
    test: /ENOTFOUND|EAI_AGAIN|getaddrinfo/i,
    message: "The target's hostname could not be resolved.",
  },
  {
    test: /ETIMEDOUT|ESOCKETTIMEDOUT|AbortError|timed? ?out/i,
    message: "The target did not respond in time.",
  },
  {
    test: /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up/i,
    message: "The target refused the connection or closed it early.",
  },
  {
    test: /CERT_|ERR_TLS|DEPTH_ZERO_SELF_SIGNED|self[- ]signed certificate|unable to verify the first certificate/i,
    message: "The target's TLS certificate could not be validated.",
  },
];

/**
 * @param stored The raw `error_message`.
 * @param kind   The row's `failure_kind`, when the caller has it. Anything that
 *               is not a known kind is treated as absent, so an older row, a
 *               NULL and a value from a newer build all take the text path.
 */
export function publicScanErrorMessage(
  stored: string | null,
  kind?: string | null,
): string {
  const known = isFailureKind(kind) ? kind : null;
  const trimmed = stored?.trim() ?? "";

  if (!trimmed) return known ? KIND_MESSAGES[known] : "The scan failed.";

  // Wording the pipeline wrote for the user wins over the generic sentence for
  // its kind: it is the same fact with the number or the limit still in it.
  if (USER_FACING_EXACT.has(trimmed)) return trimmed;
  if (USER_FACING_PATTERNS.some((re) => re.test(trimmed))) return trimmed;

  if (known) return KIND_MESSAGES[known];

  if (DATABASE_FAILURES.some((re) => re.test(trimmed))) {
    return GENERIC_SCAN_ERROR;
  }
  for (const { test, message } of CLASSIFIERS) {
    if (test.test(trimmed)) return message;
  }
  return GENERIC_SCAN_ERROR;
}
