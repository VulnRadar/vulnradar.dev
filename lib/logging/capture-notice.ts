/**
 * The marker on the rows the error-log capture writes ABOUT itself.
 *
 * lib/database/error-log-capture.ts drops some errors on purpose (identical
 * repeats, anything past the per-minute cap) and, when it does, writes one
 * summary row in their place so the panel never looks complete when it is not.
 * Admin > System > Error Logs styles those rows as a warning rather than as
 * an application error, and it can only do that by recognising the message.
 *
 * It lives in its own file because the producer imports the database pool and
 * the consumer is a client component: neither can import the other's module,
 * and a prefix typed in both places is how one of them stops matching.
 */
export const CAPTURE_NOTICE_PREFIX = "[error-capture]";

/** Whether a stored message is a capture notice rather than a real error. */
export function isCaptureNotice(message: string): boolean {
  return message.startsWith(CAPTURE_NOTICE_PREFIX);
}
