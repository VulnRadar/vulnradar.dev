/**
 * A URL pathname that is safe to write into system_error_logs.
 *
 * withErrorHandling and onRequestError both name the route that threw so a row
 * says where it came from, and the pathname is the only part of the URL they
 * keep (the query string is where reset tokens and addresses end up). But some
 * routes carry their secret IN the path: /staff-invite/[token] holds the raw
 * invite token (64 hex characters, hashed in the database and never stored
 * raw), /shared/[token] and /badge/[token] hold capability links. A route that
 * throws while one of those is in flight would write the token into a table
 * that any role with the error-log grant can read, and an invite for a higher
 * role is a way to become that role.
 *
 * So a segment that looks like an opaque token is replaced, not quoted. The
 * route template (`routePath`, which onRequestError also logs) still says which
 * route it was.
 */

// Long enough that no ordinary word or id reaches it, drawn from the alphabets
// tokens, UUIDs and hashes use.
const TOKEN_SHAPED = /^[A-Za-z0-9_-]{20,}$/;

/**
 * A plain slug (`missing-content-security-policy`) is long and made of the same
 * characters, but is all lowercase letters and hyphens. Every token format the
 * app issues has a digit or an uppercase letter in it, and a random one of this
 * length that has neither is vanishingly rare.
 */
function looksLikeToken(segment: string): boolean {
  return TOKEN_SHAPED.test(segment) && /[0-9A-Z]/.test(segment);
}

export function redactPathTokens(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (looksLikeToken(segment) ? "[redacted]" : segment))
    .join("/");
}
