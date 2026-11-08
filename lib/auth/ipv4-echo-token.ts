import { domainToken } from "@/lib/auth/domain-token";

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
 * Format mirrors lib/auth/pending-2fa.ts: base64url(json).base64url(hmac),
 * built by lib/auth/domain-token.ts.
 */

const echoToken = domainToken("vulnradar.ipv4-echo.v1", "IPv4 echo tokens");

/** How long a freshly minted echo token stays valid (seconds). */
export const IPV4_ECHO_TOKEN_MAX_AGE_SECONDS = 120;

interface EchoPayload {
  ip: string;
  ts: number;
}

/** Sign an observed IPv4 into an opaque token. `ts` is epoch milliseconds. */
export function signIpv4Token(ip: string, ts: number): string {
  return echoToken.sign({ ip, ts } satisfies EchoPayload);
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
  const payload = echoToken.verify<EchoPayload | null>(token);
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.ip !== "string" ||
    typeof payload.ts !== "number"
  ) {
    return null;
  }
  const age = now - payload.ts;
  if (age > IPV4_ECHO_TOKEN_MAX_AGE_SECONDS * 1000) return null;
  if (age < -60_000) return null; // reject tokens stamped in the future
  return payload.ip;
}
