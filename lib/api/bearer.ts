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
 * scheme (`Basic`, `Bearerx`) or carries nothing after the scheme. The token
 * is not trimmed or validated beyond that: whether it is a real key is
 * `validateApiKey`'s question. A token with whitespace inside it is not a
 * single credential, so it is refused here rather than hashed as one.
 */
const BEARER_HEADER = /^bearer +(\S+)$/i;

export function parseBearer(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER_HEADER.exec(header);
  return match ? match[1] : null;
}
