/**
 * A value nobody on the server chose (a request body field, a scanned site's
 * URL, a provider's error text, a user's saved setting), made safe to put
 * inside a log line.
 *
 * Every console.error is persisted to Admin > Error Logs
 * (lib/database/error-log-capture.ts), and that page is what an admin reads
 * to decide what happened. A CR or LF in an interpolated value starts what
 * reads as a separate entry there, so anyone who can reach a logging path can
 * write lines of their own choosing into it; a terminal escape or a bidi
 * override does the same to anyone reading the raw output. Nothing is
 * dropped: line breaks and other control and format characters are written
 * out as escapes, so a forgery attempt shows up as one.
 */

/** Long enough for a URL or a check id, short enough to leave the row readable. */
export const LOG_VALUE_MAX_CHARS = 200;

/**
 * JSON.stringify writes C0 controls, quotes and backslashes as escapes, but
 * leaves DEL, the C1 controls (U+0085 is a line break to some readers), the
 * format characters (bidi overrides, zero-width) and the Unicode line and
 * paragraph separators as they are.
 */
const UNESCAPED_BY_JSON = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

function escapeCodePoint(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = cp.toString(16);
  return cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, "0")}`;
}

/**
 * `value` as one line of at most `maxChars` source characters (escapes
 * lengthen it), with a note of the full length when it was cut.
 */
export function logValue(
  value: unknown,
  maxChars: number = LOG_VALUE_MAX_CHARS,
): string {
  const text = typeof value === "string" ? value : String(value);
  const bounded =
    text.length > maxChars
      ? `${text.slice(0, maxChars)}... [${text.length} chars]`
      : text;
  return JSON.stringify(bounded)
    .slice(1, -1)
    .replace(UNESCAPED_BY_JSON, escapeCodePoint);
}
