import { domainToken } from "@/lib/auth/domain-token";
import { isKeyHex, requireSigningKey } from "@/lib/auth/key-hex";

/**
 * Tamper-proof "first factor already passed" token for the 2FA step.
 *
 * The pending cookie set between password (or OAuth) success and 2FA
 * verification used to be forgeable: the password path stored a bare
 * `String(userId)` and the verify route "validated" it by comparing that
 * cookie to the request body's userId -- BOTH attacker-controlled, so the check
 * proved nothing. An attacker who never knew the password could send
 * `Cookie: <pending>=<victimId>` + `{userId: victimId}` and reduce a 2FA
 * account to its second factor alone. These sign the pending payload with the
 * server's key so only a real first-factor success on the server can mint one.
 *
 * Format: `base64url(json).base64url(hmacSHA256)`, built by
 * lib/auth/domain-token.ts. The HMAC is domain-separated (a fixed prefix) so
 * this key's other uses can't produce a colliding tag. The payload still
 * carries `ts`; freshness stays the caller's admin-configurable
 * `2FA_PENDING_MAX_AGE_SECONDS` check -- the signature only guarantees the ts
 * (and userId) weren't altered.
 */

const PURPOSE = "2FA pending tokens";
const pendingToken = domainToken("vulnradar.2fa-pending.v1", PURPOSE);

/** Sign a pending-2FA payload into an opaque cookie value. */
export function signPendingToken(payload: Record<string, unknown>): string {
  // domainToken only counts the key's characters. A 64-character key that is
  // not hex decodes short or empty, and a tag under an empty key is one any
  // attacker can compute, so the real check has to happen before it signs.
  requireSigningKey(PURPOSE);
  return pendingToken.sign(payload);
}

/**
 * Verify a pending-2FA token's signature and return its payload, or null if the
 * token is missing, malformed, or its signature doesn't match (i.e. it was
 * forged or tampered). Callers still enforce freshness on the returned `ts`.
 */
export function verifyPendingToken<T = Record<string, unknown>>(
  token: string | undefined | null,
): T | null {
  // A key that could not have signed anything authenticates nothing.
  if (!isKeyHex(process.env.API_KEY_ENCRYPTION_KEY)) return null;
  return pendingToken.verify<T>(token);
}
