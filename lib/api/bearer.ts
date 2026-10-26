/**
 * The one place that reads an `Authorization: Bearer <key>` header.
 *
 * RFC 9110 section 11.1 makes the auth scheme case-insensitive and allows one
 * or more spaces before the credentials, so `bearer <key>` and `BEARER  <key>`
 * are the same request as `Bearer <key>`. Every handler used to test
 * `startsWith("Bearer ")` itself, which is how a client that lowercased the
 * scheme was treated as sending no key at all.
 *
 * Returns the credentials, or null when the header is missing, uses another
 * scheme (`Basic`, `Bearerx`) or carries nothing after the scheme. The
 * credentials come back exactly as sent: whether they are a real key is
 * `validateApiKey`'s question, and that includes a token with whitespace in
 * it. Middleware still calls any header that starts with "Bearer " an API-key
 * call and waives its CSRF Origin check for one without an Origin, so a
 * handler that answered null for `Bearer one two` would fall back to the
 * session cookie on a request middleware let through as a key call. Handing
 * it to validateApiKey, which finds no such key, keeps the old answer: 401.
 */
const BEARER_HEADER = /^bearer +([^ ].*)$/i;

export function parseBearer(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER_HEADER.exec(header);
  return match ? match[1] : null;
}
