import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, signed proof that the server OBSERVED a given IPv4 on the
 * connection that hit the IPv4-only echo endpoint (GET /api/v3/whoami-ip).
 *
 * That endpoint lives on a hostname whose DNS has only an A record, so a
 * dual-stack browser is forced onto IPv4 to reach it and the endpoint sees the
 * caller's real IPv4. It cannot read the session cookie (different subdomain,
 * and the cookie is host-only), so it hands the browser this token instead;
 * the same-origin, authenticated record endpoint (POST
 * /api/v3/auth/sessions/ipv4) verifies the signature and stores the IPv4 on
 * the caller's current session. The signature is what stops a client from
 * reporting an IPv4 it was never actually seen from.
 *
 * Format mirrors lib/auth/pending-2fa.ts: base64url(json).base64url(hmac).
 */

const HMAC_DOMAIN = "vulnradar.ipv4-echo.v1";

/** How long a freshly minted echo token stays valid (seconds). */
export const IPV4_ECHO_TOKEN_MAX_AGE_SECONDS = 120;

function signingKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes) to sign IPv4 echo tokens.",
    );
  }
  return Buffer.from(hex, "hex");
}

function computeTag(payloadB64: string): string {
  // HMAC-SHA256 keyed with the server's 32-byte secret, signing a short-lived
  // TOKEN (ip + ts) -- a MAC, not a password hash. Real password hashing lives
  // in lib/auth/password-hash.ts.
  // codeql[js/insufficient-password-hash]
  return createHmac("sha256", signingKey())
    .update(`${HMAC_DOMAIN}.${payloadB64}`)
    .digest("base64url");
}

interface EchoPayload {
  ip: string;
  ts: number;
}

/** Sign an observed IPv4 into an opaque token. `ts` is epoch milliseconds. */
export function signIpv4Token(ip: string, ts: number): string {
  const payloadB64 = Buffer.from(
    JSON.stringify({ ip, ts } satisfies EchoPayload),
    "utf8",
  ).toString("base64url");
  return `${payloadB64}.${computeTag(payloadB64)}`;
}

/**
 * Verify an echo token's signature and freshness and return the IPv4 it
 * carries, or null if it is missing, malformed, forged, expired, or minted
 * implausibly far in the future (clock-skew guard). `now` is epoch
 * milliseconds, injected for testability. The caller still enforces that the
 * returned string is actually an IPv4.
 */
export function verifyIpv4Token(
  token: string | undefined | null,
  now: number,
): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const providedTag = token.slice(dot + 1);
  const expectedTag = computeTag(payloadB64);

  const a = Buffer.from(providedTag, "utf8");
  const b = Buffer.from(expectedTag, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: EchoPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.ip !== "string" || typeof payload.ts !== "number") {
    return null;
  }
  const age = now - payload.ts;
  if (age > IPV4_ECHO_TOKEN_MAX_AGE_SECONDS * 1000) return null;
  if (age < -60_000) return null; // reject tokens stamped in the future
  return payload.ip;
}
