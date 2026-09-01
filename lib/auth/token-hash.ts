import { createHash, createHmac } from "node:crypto";

/**
 * The single hashing function for the emailed single-use auth tokens:
 * password reset, and email verification (minted at signup, at resend, and
 * on a profile email change).
 *
 * Two problems it fixes at once.
 *
 * 1. It was raw `sha256(token)`, copied verbatim into five different files.
 *    HMAC-SHA256 keyed with a server secret is the canonical pattern for a
 *    stored token digest and is what every other keyed comparison in this
 *    codebase already uses (lib/auth/oauth-state.ts,
 *    lib/auth/ipv4-echo-token.ts). Against a 256-bit random token the
 *    practical gain is small, but an unkeyed digest of a value an attacker
 *    can also compute is exactly the shape that stops being safe the moment
 *    someone shortens the token, and there is no reason for these to be the
 *    exception (AUDIT-002#secrets-03).
 * 2. The one-liner existed in five copies, so any change to it would have
 *    had to be found five times.
 *
 * The secret is resolved the same way lib/auth/oauth-state.ts resolves its
 * own, and DEGRADES rather than throws: on a deployment that has set
 * neither variable this returns the old unkeyed digest, which is exactly
 * what shipped before, instead of breaking password reset outright.
 */
function tokenSecret(): string | null {
  return process.env.AUTH_SECRET || process.env.API_KEY_ENCRYPTION_KEY || null;
}

/** The digest to STORE for a freshly minted token. */
export function hashAuthToken(token: string): string {
  const secret = tokenSecret();
  if (!secret) return legacyHashAuthToken(token);
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** The pre-HMAC digest. Only for matching tokens minted before this shipped. */
export function legacyHashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Every digest a presented token could legitimately match, newest first.
 *
 * Lookups pass this to `WHERE token_hash = ANY($1::text[])` rather than
 * matching a single value, so a reset or verification link that was already
 * sitting in someone's inbox when this deployed still works. Both entries
 * are derived from the SAME presented token, so this widens nothing: a
 * caller still has to hold the raw token to produce either digest. Drop
 * `legacyHashAuthToken` from the list once the longest token lifetime
 * (EMAIL_VERIFICATION_HOURS) has elapsed since the deploy.
 */
export function authTokenHashCandidates(token: string): string[] {
  const current = hashAuthToken(token);
  const legacy = legacyHashAuthToken(token);
  return current === legacy ? [current] : [current, legacy];
}
