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
 */

/** Messages the pipeline writes deliberately, for the user, and that carry
 *  nothing but their own fixed wording. Passed through unchanged. */
const USER_FACING_EXACT = new Set([
  "Cancelled",
  "Scan failed to start.",
  "An unexpected error occurred during the scan.",
  "An unexpected error occurred during the crawl scan.",
  "Scan interrupted by a server restart. Please run it again.",
]);

/** Same, for the two messages that interpolate a configured timeout. */
const USER_FACING_PATTERNS = [
  /^Scan exceeded the \d+s time limit\.$/,
  /^Crawl scan exceeded the \d+s time limit\.$/,
];

/**
 * Coarse classification of the common transport failures. Each branch maps to
 * a FIXED sentence: nothing from the raw message is interpolated, so the host,
 * IP and port an error like `connect ECONNREFUSED 10.0.0.5:5432` carries never
 * reach the response.
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

/** What every unrecognised message collapses to. */
export const GENERIC_SCAN_ERROR =
  "The scan could not be completed because of an internal error. Please try again.";

export function publicScanErrorMessage(stored: string | null): string {
  if (!stored) return "The scan failed.";
  const trimmed = stored.trim();
  if (!trimmed) return "The scan failed.";

  if (USER_FACING_EXACT.has(trimmed)) return trimmed;
  if (USER_FACING_PATTERNS.some((re) => re.test(trimmed))) return trimmed;

  for (const { test, message } of CLASSIFIERS) {
    if (test.test(trimmed)) return message;
  }
  return GENERIC_SCAN_ERROR;
}
