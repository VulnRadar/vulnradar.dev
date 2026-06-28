/**
 * scanner: filter sensitive response headers before persisting them
 * to scan_history.response_headers.
 *
 * The original behavior copied every header — including Set-Cookie,
 * Cookie, Authorization (if echoed), and any session tokens issued
 * by the scan target — into a JSONB column that lives in the DB for
 * the full plan retention window (up to indefinite for paid
 * plans). A read-only DB compromise yielded every scan-target
 * session token ever issued.
 *
 * This helper returns a copy of the headers map with sensitive keys
 * redacted (replaced with `"[redacted]"`). The redact list is
 * case-insensitive and enforced server-side.
 */
const REDACTED_HEADERS = new Set([
  "set-cookie",
  "cookie",
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "proxy-authenticate",
  "x-csrf-token",
  "x-xsrf-token",
]);

export function redactSensitiveResponseHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (REDACTED_HEADERS.has(key.toLowerCase())) {
      out[key] = "[redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}
