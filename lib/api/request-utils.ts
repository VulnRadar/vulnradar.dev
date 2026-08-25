import { headers } from "next/headers";
import { isIP } from "node:net";
import { AUTH_HEADER, BEARER_PREFIX } from "@/lib/config/constants";

/**
 * Client information helpers
 */

/**
 * Returns true if `ip` falls within any of the comma-separated CIDR ranges
 * listed in `cidrList` (e.g. "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16").
 *
 * Used to walk `x-forwarded-for` from the right and skip
 * trusted hops when TRUSTED_PROXY_CIDR is configured. Without this, an
 * attacker could spoof their IP by sending a custom `x-forwarded-for` header.
 */
function ipInCidrList(ip: string, cidrList: string): boolean {
  // isIP returns 0 for invalid, 4 for IPv4, 6 for IPv6.
  const version = isIP(ip) as 0 | 4 | 6;
  if (version === 0) return false;

  const cidrs = cidrList
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  for (const cidr of cidrs) {
    const [base, prefixStr] = cidr.split("/");
    if (!base || !prefixStr) continue;
    const baseVersion = isIP(base) as 0 | 4 | 6;
    if (baseVersion !== version) continue;
    const prefix = Number(prefixStr);
    if (
      !Number.isFinite(prefix) ||
      prefix < 0 ||
      prefix > (version === 4 ? 32 : 128)
    ) {
      continue;
    }
    if (ipInCidr(ip, base, prefix, version)) return true;
  }
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    acc = acc * 256 + n;
  }
  return acc;
}

function ipv6ToBigInt(ip: string): bigint | null {
  // Expand :: shorthand.
  const doubleColonIdx = ip.indexOf("::");
  let head: string[];
  let tail: string[];
  if (doubleColonIdx === -1) {
    head = ip.split(":");
    tail = [];
  } else {
    head = ip.slice(0, doubleColonIdx).split(":");
    tail = ip.slice(doubleColonIdx + 2).split(":");
    if (head.length === 1 && head[0] === "") head = [];
    if (tail.length === 1 && tail[0] === "") tail = [];
  }
  if (head.length + tail.length > 8) return null;
  const fillCount = 8 - (head.length + tail.length);
  const groups = [...head, ...new Array(fillCount).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let acc = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    acc = (acc << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return acc;
}

function ipInCidr(
  ip: string,
  base: string,
  prefix: number,
  version: 4 | 6,
): boolean {
  if (prefix === 0) return true;
  if (version === 4) {
    const ipN = ipv4ToInt(ip);
    const baseN = ipv4ToInt(base);
    if (ipN === null || baseN === null) return false;
    const mask = prefix === 32 ? -1 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipN & mask) === (baseN & mask);
  }
  const ipB = ipv6ToBigInt(ip);
  const baseB = ipv6ToBigInt(base);
  if (ipB === null || baseB === null) return false;
  const shift = BigInt(128 - prefix);
  return ipB >> shift === baseB >> shift;
}

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
 * Reuses the same masking logic as ipInCidr() above rather than adding a
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
 * Normalize a raw address string into a canonical IP, or null if it is not a
 * valid IP. Proxies and runtimes hand us addresses that are "an IP with
 * extra": an appended `:port`, IPv6 wrapped in `[brackets]`, or an
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`), and occasionally something that is not
 * an IP at all. Anything that persists or displays the client IP (session and
 * device rows, API-key last-seen IP) must never store one of those, so this
 * strips the wrapping and validates with `isIP` before returning.
 *
 * A syntactically valid IP, including a compressed IPv6 like `2001:db8::1`, is
 * returned unchanged: there is nothing to fix about a real address.
 */
export function normalizeIp(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;

  if (s.startsWith("[")) {
    // Bracketed IPv6, optionally with a :port after the closing bracket.
    const end = s.indexOf("]");
    if (end === -1) return null;
    s = s.slice(1, end);
  } else if (s.split(":").length === 2) {
    // Exactly one colon means an IPv4 host with a :port. Unbracketed IPv6
    // always has more than one colon, so this never truncates an IPv6.
    const [host, port] = s.split(":");
    if (isIP(host) === 4 && /^\d+$/.test(port)) s = host;
  }

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) -> the plain IPv4 it carries.
  if (s.toLowerCase().startsWith("::ffff:") && isIP(s.slice(7)) === 4) {
    s = s.slice(7);
  }

  return isIP(s) ? s : null;
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
  const authHeader = h.get(AUTH_HEADER);
  if (!authHeader?.startsWith(BEARER_PREFIX)) return null;
  return authHeader.slice(BEARER_PREFIX.length);
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
