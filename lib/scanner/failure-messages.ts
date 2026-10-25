/**
 * The reasons the scan pipeline writes on purpose, as stored in
 * `scan_history.error_message`.
 *
 * Each of these used to be a string literal at its writer AND a second
 * literal in lib/api/scan-error-message.ts's pass-through list, kept equal by
 * hand. They drifted: the bulk limit and batch-deadline texts were written
 * and never listed, so a user who ran out of quota was told "an internal
 * error" about a sentence that was already written for them. Both sides now
 * import the one string.
 *
 * Plain constants with no imports, so the read boundary can use them without
 * pulling the scanner in.
 */

/** The owner pressed Cancel. Exact: several UIs compare against it. */
export const SCAN_CANCELLED_MESSAGE = "Cancelled";

/** Staff cancelled it from the admin queue. */
export const SCAN_ADMIN_CANCELLED_MESSAGE = "Cancelled by an administrator.";

/** The boot sweep found it left running by a previous process. */
export const SCAN_INTERRUPTED_MESSAGE =
  "Scan interrupted by a server restart. Please run it again.";

/** The periodic sweep or the admin button closed it; no restart happened. */
export const SCAN_STALE_MESSAGE =
  "The scan stopped responding and was closed. Please run it again.";

/** The account's daily scan allowance was spent. */
export const DAILY_LIMIT_MESSAGE =
  "Daily scan limit reached. Upgrade your plan or wait until midnight UTC for the limit to reset.";

/** The API key's own daily limit ran out part-way through a batch. */
export const API_KEY_LIMIT_MESSAGE = "API key daily limit reached mid-batch.";

/** A bulk batch ran out of its time budget before reaching this URL. */
export function bulkDeadlineMessage(timeoutSeconds: number): string {
  return `Bulk scan batch exceeded its ${timeoutSeconds}s time limit before this URL ran.`;
}

/** A bulk batch stopped for some other reason before reaching this URL. */
export const BULK_STOPPED_MESSAGE =
  "The bulk scan batch this URL belonged to stopped before it ran.";
