import { headers } from "next/headers";
import { isIP } from "node:net";
import { AUTH_HEADER } from "@/lib/config/constants";
import { parseBearer } from "@/lib/api/bearer";
import {
  ipInCidrList,
  ipv4ToInt,
  ipv6ToBigInt,
  normalizeIp,
} from "@/lib/server/http-front.mjs";

export { normalizeIp };

/**
 * Client information helpers
 */

/**
 * ip-binding: compare two IPs at subnet granularity instead of requiring
 * an exact match. Used to check a session or API key request's current
 * IP (from getClientIp() below) against the IP recorded when the
 * session/key was first seen — see lib/auth/auth.ts and
 * lib/api/api-keys.ts. Subnet-level comparison tolerates the common case
 * of an ISP or carrier rotating the last IPv4 octet mid-session, while
 * still catching a request from a genuinely different network.
 *
 * Returns false for anything that is not a valid, same-version IP pair
 * (including the literal string "unknown" that getClientIp() falls back
 * to). Callers decide what an unparsable IP means for their own
 * mismatch policy — this function only answers the subnet question.
 *
 * Reuses the masking logic in lib/server/http-front.mjs rather than adding a
 * second IP-comparison implementation.
 */
export function ipsInSameSubnet(
  ipA: string,
  ipB: string,
  ipv4PrefixBits: number,
  ipv6PrefixBits: number,
): boolean {
  const versionA = isIP(ipA) as 0 | 4 | 6;
  const versionB = isIP(ipB) as 0 | 4 | 6;
  if (versionA === 0 || versionB === 0 || versionA !== versionB) return false;

  if (versionA === 4) {
    const prefix = Math.min(Math.max(Math.trunc(ipv4PrefixBits), 0), 32);
    if (prefix === 0) return true;
    const a = ipv4ToInt(ipA);
    const b = ipv4ToInt(ipB);
    if (a === null || b === null) return false;
    const mask = prefix === 32 ? -1 : (0xffffffff << (32 - prefix)) >>> 0;
    return (a & mask) === (b & mask);
  }

  const prefix = Math.min(Math.max(Math.trunc(ipv6PrefixBits), 0), 128);
  if (prefix === 0) return true;
  const a = ipv6ToBigInt(ipA);
  const b = ipv6ToBigInt(ipB);
  if (a === null || b === null) return false;
  const shift = BigInt(128 - prefix);
  return a >> shift === b >> shift;
}

/**
 * Extract client IP from request headers.
 *
 * Trusts `x-forwarded-for` correctly when running behind
 * a known proxy. Set `TRUSTED_PROXY_CIDR` to a comma-separated list of
 * CIDR ranges (e.g. "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8")
 * to enable right-to-left trust-chain parsing.
 *
 * Every candidate is run through `normalizeIp`, so a hop with a port,
 * brackets, an IPv4-mapped prefix, or plain garbage is cleaned up or skipped;
 * the result is always a syntactically valid IP or the literal "unknown".
 *
 * - If `TRUSTED_PROXY_CIDR` is set: walk `x-forwarded-for` from the right
 *   and return the first IP that is NOT in a trusted range. This is the
 *   client (or the last untrusted hop).
 * - If not set: take the rightmost IP from `x-forwarded-for` (safer than
 *   leftmost, which is trivially spoofable when no proxy is in play).
 * - Falls back to `x-real-ip`, then `cf-connecting-ip`, then "unknown".
 *
 * The right-most rule is only safe because server.mjs has already replaced the
 * header on any connection whose peer is not a trusted proxy.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  const trustedCidr = process.env.TRUSTED_PROXY_CIDR;

  if (xff) {
    // Normalize every hop and drop anything that is not a real IP, so a
    // malformed or port-suffixed hop can never become the returned client IP.
    const hops = xff
      .split(",")
      .map((s) => normalizeIp(s))
      .filter((ip): ip is string => ip !== null);
    if (trustedCidr) {
      // Walk right-to-left, return first IP not in a trusted CIDR.
      for (let i = hops.length - 1; i >= 0; i--) {
        if (!ipInCidrList(hops[i], trustedCidr)) {
          return hops[i];
        }
      }
    } else {
      // No trusted proxy configured: take the rightmost hop.
      const rightmost = hops[hops.length - 1];
      if (rightmost) return rightmost;
    }
  }

  return (
    normalizeIp(h.get("x-real-ip") ?? "") ??
    normalizeIp(h.get("cf-connecting-ip") ?? "") ??
    "unknown"
  );
}

/**
 * Bits of an IPv6 address that identify the customer rather than the host.
 * A residential or hosting IPv6 allocation is a /64 at minimum (often a /48 or
 * /56), so every address inside one /64 belongs to the same subscriber.
 * Not admin-configurable, unlike the session/API-key binding prefixes: this is
 * an abuse-control bucket width, and widening it at runtime would hand an
 * attacker the bypass back.
 */
const RATE_LIMIT_IPV6_PREFIX_BITS = 64;

/**
 * Bucket key for an IP-keyed rate limit.
 *
 * checkRateLimit treats its key as an opaque string, so using the raw address
 * gave anyone with a routed IPv6 block 2^64 independent buckets in it: the
 * login, signup, forgot-password, resend-verification, contact, demo-scan and
 * public-scans limiters were all effectively unlimited from a single cheap VPS
 * allocation. Collapsing IPv6 to its /64 makes one subscriber one bucket.
 *
 * IPv4 is returned unchanged: a v4 address is already close to one subscriber,
 * and masking it would merge unrelated users behind a carrier NAT into a
 * shared bucket, which locks out bystanders. "unknown" passes through so the
 * existing single shared bucket for un-resolvable IPs is unaffected.
 *
 * Deliberately separate from getClientIp(), which keeps returning the exact
 * address: audit logs, session binding and login-alert emails all need it.
 */
export function rateLimitIpKey(ip: string): string {
  if (isIP(ip) !== 6) return ip;
  const asInt = ipv6ToBigInt(ip);
  if (asInt === null) return ip;
  const shift = BigInt(128 - RATE_LIMIT_IPV6_PREFIX_BITS);
  return `${(asInt >> shift).toString(16)}::/${RATE_LIMIT_IPV6_PREFIX_BITS}`;
}

/**
 * Get user agent from request
 */
export async function getUserAgent(): Promise<string> {
  const h = await headers();
  return h.get("user-agent") || "unknown";
}

/**
 * Get referer from request
 */
export async function getReferer(): Promise<string | null> {
  const h = await headers();
  return h.get("referer");
}

/**
 * Extract bearer token from authorization header
 */
export async function getBearerToken(): Promise<string | null> {
  const h = await headers();
  return parseBearer(h.get(AUTH_HEADER));
}

/**
 * Check if request is from a bot/crawler
 */
export async function isBot(): Promise<boolean> {
  const ua = await getUserAgent();
  const botPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /headless/i,
    /googlebot/i,
    /bingbot/i,
  ];
  return botPatterns.some((pattern) => pattern.test(ua));
}

/**
 * Check if request is CORS preflight
 */
export function isPreflight(method: string): boolean {
  return method === "OPTIONS";
}

/**
 * Get request method safe-check
 */
export function isMethod(method: string, ...allowed: string[]): boolean {
  return allowed.includes(method.toUpperCase());
}
