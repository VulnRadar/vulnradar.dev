import { createHmac, timingSafeEqual } from "node:crypto";

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
 * Format: `base64url(json).base64url(hmacSHA256)`. The HMAC is domain-separated
 * (a fixed prefix) so this key's other uses can't produce a colliding tag. The
 * payload still carries `ts`; freshness stays the caller's admin-configurable
 * `2FA_PENDING_MAX_AGE_SECONDS` check -- the signature only guarantees the ts
 * (and userId) weren't altered.
 */

const HMAC_DOMAIN = "vulnradar.2fa-pending.v1";

function signingKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign 2FA pending tokens.",
    );
  }
  return Buffer.from(hex, "hex");
}

function computeTag(payloadB64: string): string {
  return createHmac("sha256", signingKey())
    .update(`${HMAC_DOMAIN}.${payloadB64}`)
    .digest("base64url");
}

/** Sign a pending-2FA payload into an opaque cookie value. */
export function signPendingToken(payload: Record<string, unknown>): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${payloadB64}.${computeTag(payloadB64)}`;
}

/**
 * Verify a pending-2FA token's signature and return its payload, or null if the
 * token is missing, malformed, or its signature doesn't match (i.e. it was
 * forged or tampered). Callers still enforce freshness on the returned `ts`.
 */
export function verifyPendingToken<T = Record<string, unknown>>(
  token: string | undefined | null,
): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedTag = token.slice(dot + 1);
  const expectedTag = computeTag(payloadB64);

  const a = Buffer.from(providedTag, "utf8");
  const b = Buffer.from(expectedTag, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as T;
  } catch {
    return null;
  }
}
