/**
 * Safe Fetch Utility - SSRF Protection
 *
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";
import { blockedForAuthenticatedRequest } from "./auth/logout-guard";
import type { ScanSessionBinding } from "./auth/types";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// Keep in sync with scan route timeout defaults (crawl: 8s, scan routes: 15s)
// safeFetch enforces a 15s max to align with most scan operations
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

// Basic hostname patterns we never want to scan directly, regardless of DNS resolution.
// These are a fast, syntactic safeguard that complements validateScanTarget's IP-based checks.
const DISALLOWED_HOSTNAMES = ["localhost"];
const DISALLOWED_HOSTNAME_SUFFIXES = [".local", ".internal", ".lan"];

/**
 * Combine a required timeout signal with an optional caller-provided signal so that
 * the returned signal aborts when either source signal aborts.
 */
function combineAbortSignals(
  timeoutSignal: AbortSignal,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: (() => void) | undefined } {
  if (!callerSignal) {
    return { signal: timeoutSignal, cleanup: undefined };
  }

  // If either signal is already aborted, return a signal in the aborted state.
  if (timeoutSignal.aborted || callerSignal.aborted) {
    const controller = new AbortController();
    controller.abort();
    return { signal: controller.signal, cleanup: undefined };
  }

  const controller = new AbortController();

  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  timeoutSignal.addEventListener("abort", onAbort, { once: true });
  callerSignal.addEventListener("abort", onAbort, { once: true });

  const cleanup = () => {
    timeoutSignal.removeEventListener("abort", onAbort);
    callerSignal.removeEventListener("abort", onAbort);
  };

  return { signal: controller.signal, cleanup };
}

// IPv4 private ranges (RFC 1918 + special ranges)
const PRIVATE_IPV4_PATTERNS = [
  /^127\./, // Loopback (127.0.0.0/8)
  /^10\./, // Private A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private B (172.16.0.0/12)
  /^192\.168\./, // Private C (192.168.0.0/16)
  /^169\.254\./, // Link-local (169.254.0.0/16) — covers cloud metadata 169.254.169.254
  /^0\./, // Current network (0.0.0.0/8)
  /^2(2[4-9]|3[0-9])\./, // Multicast (224.0.0.0/4 = 224-239.x.x.x)
  /^(24[0-9]|25[0-5])\./, // Reserved/broadcast first octet range 240-255
  // ssrf: RFC 6598 shared address space (100.64.0.0/10). This is not an
  // academic gap. 100.100.100.200 is Alibaba Cloud's instance metadata
  // endpoint, the direct analogue of the 169.254.169.254 blocked two lines
  // up, and 100.100.2.136/.138 are its internal resolvers. The same /10 is
  // what EKS and GKE hand to pods and what carrier-grade NAT uses, so on
  // those platforms it is live internal space. isPrivateIP feeds the
  // IPv4-mapped/NAT64 IPv6 path too, so this also closes
  // http://[::ffff:100.100.100.200]/. ref: AUDIT-012#ssrf-03
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // 100.64.0.0/10
  /^198\.1[89]\./, // Benchmarking (198.18.0.0/15), routed internally on many networks
  /^192\.0\.0\./, // IETF protocol assignments (192.0.0.0/24)
  /^192\.0\.2\./, // TEST-NET-1
  /^198\.51\.100\./, // TEST-NET-2
  /^203\.0\.113\./, // TEST-NET-3
];

// IPv6 private/special ranges.
// Patterns are tested against the canonical 8-group form returned by
// toCanonicalIPv6() below (e.g. "0000:0000:0000:0000:0000:0000:0000:0001"
// for "::1"). Shorthand forms (::1, fc00::1) are normalised first, so
// these regexes need to match the expanded 8-group form.
//
// ssrf: each pattern anchors on a WHOLE 16-bit group, so a prefix shorter
// than 16 bits has to be spelled out across the group's hex digits. Three of
// these used to name a /7 or /10 in the comment while matching exactly one
// group: /^fe80:/ covered only fe80 of fe80::/10 (fe80-febf), /^fc00:/ only
// fc00 of fc00::/7 (fc00-fdff), and /^fec0:/ only fec0 of fec0::/10
// (fec0-feff). fe81::1, fcff::1 and fec1::1 all canonicalised to something no
// pattern matched, so isPrivateIP returned false for them: legal, and in use
// as ULA space on some Kubernetes and overlay networks. The forms below match
// the prefix lengths the comments claim. ref: AUDIT-012#ssrf-05
const PRIVATE_IPV6_PATTERNS = [
  /^0000:0000:0000:0000:0000:0000:0000:0001$/i, // IPv6 loopback (::1)
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local (fe80::/10 = fe80-febf)
  /^f[cd][0-9a-f]{2}:/i, // IPv6 unique local (ULA) (fc00::/7 = fc00-fdff)
  /^0000:0000:0000:0000:0000:0000:0000:0000$/, // Unspecified (::)
  /^0000:0000:0000:0000:0000:ffff:7f00:/i, // IPv4-mapped 127.0.0.0/8
  /^0000:0000:0000:0000:0000:ffff:0a00:/i, // IPv4-mapped 10.0.0.0/8
  /^0000:0000:0000:0000:0000:ffff:ac1[0-9a-f]:/i, // IPv4-mapped 172.16.0.0/12 (172.16-172.31)
  /^0000:0000:0000:0000:0000:ffff:ac2[0-9a-f]:/i, // 172.16.0.0/12
  /^0000:0000:0000:0000:0000:ffff:ac3[01]:/i, // 172.16.0.0/12
  /^0000:0000:0000:0000:0000:ffff:c0a8:/i, // IPv4-mapped 192.168.0.0/16
  /^0000:0000:0000:0000:0000:ffff:a9fe:/i, // IPv4-mapped 169.254.0.0/16
  /^0000:0000:0000:0000:0000:ffff:0000:/i, // IPv4-mapped 0.0.0.0/8
  /^0000:0000:0000:0000:0000:ffff:e000:/i, // IPv4-mapped 224.0.0.0/4 multicast
  /^0000:0000:0000:0000:0000:ffff:f[0-9a-f][0-9a-f][0-9a-f]:/i, // IPv4-mapped 240.0.0.0/4
  /^0064:ff9b:0000:0000:0000:0000:/i, // RFC 6052 NAT64 well-known prefix
  /^0100:0000:0000:0000:0000:0000:/i, // Discard prefix (RFC 6666) (100::/64)
  /^2001:0db8:/i, // Documentation prefix (RFC 3849)
  /^2001:0000:/i, // Teredo tunneling (RFC 4380) (2001::/32)
  /^fe[c-f][0-9a-f]:/i, // IPv6 site-local, deprecated RFC 3879 (fec0::/10 = fec0-feff)
  /^ff0[0-9a-f]:/i, // IPv6 multicast (ff00::/8)
];

export interface SafetyCheckResult {
  safe: boolean;
  reason?: string;
  resolvedIp?: string;
}

/**
 * Check if an IP address is in a private/internal range
 */
export function isPrivateIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    // Apply IPv4 private and special-range checks
    return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(ip));
  }
  if (version === 6) {
    // R6 hardening: detect IPv4-mapped/natted addresses in any notation
    // (long expanded `0:0:0:0:0:ffff:127.0.0.1`, hex-encoded
    // `::ffff:7f00:1`, RFC 6052 NAT64 `64:ff9b::7f00:1`) and check the
    // embedded IPv4 against our IPv4 private ranges. The regex-based
    // IPv6 patterns below cover the remaining native IPv6 private ranges.
    const canonical = toCanonicalIPv6(ip);
    const extractedV4 = ipv4MappedToDotted(canonical);
    if (extractedV4 && PRIVATE_IPV4_PATTERNS.some((p) => p.test(extractedV4))) {
      return true;
    }
    return PRIVATE_IPV6_PATTERNS.some((pattern) => pattern.test(canonical));
  }
  // Not a valid IP address: treat as unsafe/private to avoid bypassing checks
  return true;
}

/**
 * If `canonicalIp` is an IPv4-mapped (::ffff:a.b.c.d) or RFC 6052 NAT64
 * (64:ff9b::a.b.c.d) address, return the embedded IPv4 in dotted form.
 * Returns null otherwise.
 */
function ipv4MappedToDotted(canonicalIp: string): string | null {
  const groups = canonicalIp.split(":");
  if (groups.length !== 8) return null;

  // IPv4-mapped IPv6: ::ffff:X.X.X.X → groups[0..4] = 0, groups[5] = ffff
  if (
    groups[0] === "0000" &&
    groups[1] === "0000" &&
    groups[2] === "0000" &&
    groups[3] === "0000" &&
    groups[4] === "0000" &&
    groups[5] === "ffff"
  ) {
    return hexGroupPairToDotted(groups[6], groups[7]);
  }

  // RFC 6052 well-known NAT64: 0064:ff9b::X.X.X.X
  if (groups[0] === "0064" && groups[1] === "ff9b") {
    return hexGroupPairToDotted(groups[6], groups[7]);
  }

  return null;
}

function hexGroupPairToDotted(hi: string, lo: string): string | null {
  const hiNum = parseInt(hi, 16);
  const loNum = parseInt(lo, 16);
  if (Number.isNaN(hiNum) || Number.isNaN(loNum)) return null;
  return `${(hiNum >> 8) & 0xff}.${hiNum & 0xff}.${(loNum >> 8) & 0xff}.${loNum & 0xff}`;
}

/**
 * Canonicalize an IPv6 address into its full 8-group lowercase form, expanding
 * any embedded IPv4 suffix (last 32 bits) into two 16-bit groups. This is the
 * only safe form for regex-based private-range checks.
 *
 * Examples:
 *   "::ffff:127.0.0.1"   → "0000:0000:0000:0000:0000:ffff:7f00:0001"
 *   "::ffff:7f00:1"      → "0000:0000:0000:0000:0000:ffff:7f00:0001"
 *   "0:0:0:0:0:ffff:127.0.0.1" → "0000:0000:0000:0000:0000:ffff:7f00:0001"
 *   "64:ff9b::7f00:1"    → "0064:ff9b:0000:0000:0000:0000:7f00:0001"
 *   "FE80::1"            → "fe80:0000:0000:0000:0000:0000:0000:0001"
 */
function toCanonicalIPv6(ip: string): string {
  const lower = ip.toLowerCase();

  // Split on "::" once. If absent, parts.length === 1.
  const halves = lower.split("::");
  if (halves.length > 2) {
    // Malformed — return as-is; downstream regex checks will fail closed.
    return lower;
  }

  const splitGroup = (s: string): string[] => (s === "" ? [] : s.split(":"));

  const left = splitGroup(halves[0]);
  const right = halves.length === 2 ? splitGroup(halves[1]) : [];

  // Expand a final group that contains "." into two 16-bit hex groups.
  // Returns a NEW array so callers can use it without worrying about
  // mutation order with subsequent length-dependent operations.
  const expandFinalV4 = (groups: readonly string[]): string[] => {
    if (groups.length === 0) return [...groups];
    const last = groups[groups.length - 1];
    if (!last.includes(".")) return [...groups];
    const octets = last.split(".");
    if (octets.length !== 4 || !octets.every((o) => /^\d+$/.test(o))) {
      return [...groups]; // Malformed — let downstream fail closed.
    }
    const [a, b, c, d] = octets.map((o) => Number(o));
    if (![a, b, c, d].every((n) => n >= 0 && n <= 255)) return [...groups];
    return [
      ...groups.slice(0, -1),
      ((a << 8) | b).toString(16).padStart(4, "0"),
      ((c << 8) | d).toString(16).padStart(4, "0"),
    ];
  };

  let groups: string[];
  if (halves.length === 1) {
    groups = expandFinalV4(left);
  } else {
    // Expand IPv4 in the rightmost half's final group first (if any).
    // expandFinalV4 returns a fresh array so we can safely replace
    // `right` without affecting the spread length calculation below.
    const expandedRight = expandFinalV4(right);
    const missing = 8 - (left.length + expandedRight.length);
    if (missing < 0) return lower; // Malformed.
    groups = [...left, ...Array(missing).fill("0"), ...expandedRight];
  }

  if (groups.length !== 8) return lower;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

/**
 * Helper function to set the Host header while preserving existing headers
 */
function setHostHeader(
  init: RequestInit | undefined,
  hostname: string,
): RequestInit {
  const existingInit = init || {};
  const existingHeaders = existingInit.headers;
  let headers: HeadersInit;

  if (existingHeaders) {
    if (Array.isArray(existingHeaders)) {
      headers = [...existingHeaders, ["Host", hostname]];
    } else if (existingHeaders instanceof Headers) {
      const newHeaders = new Headers(existingHeaders);
      newHeaders.set("Host", hostname);
      headers = newHeaders;
    } else {
      headers = { ...existingHeaders, Host: hostname };
    }
  } else {
    headers = { Host: hostname };
  }

  return { ...existingInit, headers };
}

/**
 * Rewrite an HTTP url to target the IP a prior validateScanTarget already
 * resolved (with the real host preserved in a Host header), so the OS cannot
 * re-resolve the hostname to a rebound private/metadata IP at connect time.
 * HTTPS is returned unchanged: swapping the hostname would break TLS/SNI.
 * That leaves a real, un-closed gap on the HTTPS path, and it should not be
 * read as a protection. An attacker serving a TTL-0 A record can answer
 * validateScanTarget's lookup with a public IP and undici's connect-time
 * lookup with an internal one, so on HTTPS the private-range block list is
 * advisory. Certificate validation still stops a response body coming back,
 * but the TCP connect and ClientHello do happen. Closing it properly needs a
 * per-request undici Agent whose `connect.lookup` returns the address already
 * validated (keeping the hostname for SNI), which needs `undici` as a direct
 * dependency this repo does not have yet. ref: AUDIT-012#ssrf-02
 * Unlike safeFetch this does NOT
 * touch redirect handling, so a probe that needs to inspect a raw cross-host
 * 3xx (e.g. the open-redirect canary) keeps working. Pass the `resolvedIp`
 * from the SafetyCheckResult you already validated the url with.
 */
export function pinToResolvedIp(
  url: string,
  resolvedIp: string | undefined,
  init?: RequestInit,
): { url: string; init: RequestInit | undefined } {
  if (!resolvedIp) return { url, init };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, init };
  }
  if (parsed.protocol !== "http:") return { url, init };

  const originalHostname = parsed.hostname;
  const originalPort = parsed.port;
  parsed.hostname = isIP(resolvedIp) === 6 ? `[${resolvedIp}]` : resolvedIp;
  if (originalPort) parsed.port = originalPort;
  return { url: parsed.href, init: setHostHeader(init, originalHostname) };
}

/**
 * Merge extra headers onto an init, with the extras winning. Returns a new
 * init: the caller's object is never mutated, which is what keeps
 * session headers from leaking from one redirect hop to the next.
 */
function withExtraHeaders(
  init: RequestInit | undefined,
  extra: Record<string, string>,
): RequestInit {
  const existingInit = init || {};
  const merged = new Headers();

  const existingHeaders = existingInit.headers;
  if (existingHeaders) {
    if (Array.isArray(existingHeaders)) {
      for (const [key, value] of existingHeaders) merged.set(key, value);
    } else if (existingHeaders instanceof Headers) {
      existingHeaders.forEach((value, key) => merged.set(key, value));
    } else {
      for (const [key, value] of Object.entries(existingHeaders)) {
        merged.set(key, value);
      }
    }
  }

  for (const [key, value] of Object.entries(extra)) merged.set(key, value);

  return { ...existingInit, headers: merged };
}

/** Drop named headers from an init, whichever of the three shapes it uses. */
function withoutHeaders(
  init: RequestInit | undefined,
  names: string[],
): RequestInit {
  const existingInit = init || {};
  const existingHeaders = existingInit.headers;
  if (!existingHeaders) return { ...existingInit };

  const lowered = new Set(names.map((n) => n.toLowerCase()));
  const kept = new Headers();
  const keep = (value: string, key: string) => {
    if (!lowered.has(key.toLowerCase())) kept.set(key, value);
  };

  if (Array.isArray(existingHeaders)) {
    for (const [key, value] of existingHeaders) keep(value, key);
  } else if (existingHeaders instanceof Headers) {
    existingHeaders.forEach(keep);
  } else {
    for (const [key, value] of Object.entries(existingHeaders))
      keep(value, key);
  }

  return { ...existingInit, headers: kept };
}

/**
 * Turn a non-GET request into a GET and drop its body, the way a browser
 * does on a 301, 302 or 303.
 *
 * This matters well beyond spec conformance. Without it, a login POST whose
 * response is a 302 would be replayed, credentials and all, against every
 * URL in the redirect chain. 307 and 308 exist precisely to preserve the
 * method, so they are left alone.
 */
function downgradeToGet(init: RequestInit | undefined): RequestInit {
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") return { ...(init || {}) };
  const stripped = withoutHeaders(init, [
    "content-type",
    "content-length",
    "content-encoding",
    "transfer-encoding",
  ]);
  return { ...stripped, method: "GET", body: undefined };
}

/** True when `url` sits on `origin`. Used for session scope decisions. */
function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin.toLowerCase() === origin.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Check if a hostname is blocked
 */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  const hostLabels = lower.split(".").filter(Boolean);
  const matchesBlockedHostname = DISALLOWED_HOSTNAMES.some((blocked) => {
    const blockedLabels = blocked.toLowerCase().split(".").filter(Boolean);

    if (hostLabels.length < blockedLabels.length) return false;

    for (let i = 1; i <= blockedLabels.length; i++) {
      if (
        hostLabels[hostLabels.length - i] !==
        blockedLabels[blockedLabels.length - i]
      ) {
        return false;
      }
    }

    return true;
  });
  const matchesBlockedSuffix = DISALLOWED_HOSTNAME_SUFFIXES.some((suffix) =>
    lower.endsWith(suffix),
  );
  return matchesBlockedHostname || matchesBlockedSuffix;
}

/**
 * R6: Combined SSRF helper — returns true if the target hostname is
 * either an explicit private/internal IP literal or a blocked hostname
 * suffix. Replaces the duplicate implementations previously living in
 * lib/scanner/async-checks.ts (manual octet parsing) and ad-hoc checks
 * scattered across webhooks/schedules routes.
 */
export function isPrivateHostname(hostname: string): boolean {
  const cleaned = hostname.toLowerCase().replace(/\.$/, "");
  // IP literal — use the regex-based isPrivateIP for full RFC coverage.
  if (isIP(cleaned)) {
    return isPrivateIP(cleaned);
  }
  // Blocked hostnames (localhost, .local, .internal, .lan, *.localhost).
  return isBlockedHostname(cleaned);
}

/**
 * Validate a URL for safe scanning
 * Returns safety status and reason if blocked
 *
 * Deliberately NOT memoized, even though a single scan calls this 12-20
 * times for one host and every call is a blocking getaddrinfo on the
 * four-thread libuv pool (AUDIT-012#perf-10). A memo was tried and reverted:
 * safeFetch re-validates on every redirect hop precisely so a host that
 * rebinds to a private IP between hops is caught, and any cache long enough
 * to be worth having serves the first, public answer to that second call.
 * The cost of the repeated lookups is real; silently reopening the rebinding
 * window to save them is not a trade worth making here.
 */
export async function validateScanTarget(
  url: string,
): Promise<SafetyCheckResult> {
  try {
    const parsed = new URL(url);

    // ssrf: the scheme gate belongs HERE, not only in
    // assertSafePublicHttpUrl. Every module that treats this function as
    // "the" SSRF guard (page-screenshot, checks/tls, the async-check
    // probes, the schedules/webhooks routes) called something that looked
    // at the hostname and never at the protocol. file: and data: URLs
    // happened to fail anyway, but only as a side effect of an empty
    // hostname resolving to nothing, and ftp:/gopher: passed outright.
    // ref: AUDIT-012#ssrf-07
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return {
        safe: false,
        reason: "Only http and https URLs can be scanned.",
      };
    }

    const hostname = parsed.hostname;

    // Check if hostname is an IP address (IPv4 or IPv6)
    const ipVersion = isIP(hostname);
    if (ipVersion !== 0) {
      // Direct IP address - check if private
      if (isPrivateIP(hostname)) {
        return {
          safe: false,
          reason: `Scanning internal/private IP addresses is not allowed for security reasons.`,
        };
      }
      return { safe: true, resolvedIp: hostname };
    }

    // Check blocked hostnames
    if (isBlockedHostname(hostname)) {
      return {
        safe: false,
        reason: `Scanning internal hostnames (${hostname}) is not allowed for security reasons.`,
      };
    }

    // Resolve hostname to IP and check
    try {
      const addresses = await lookup(hostname, { all: true });
      for (const addr of addresses) {
        if (isPrivateIP(addr.address)) {
          return {
            safe: false,
            reason: `Domain resolves to internal IP address. Scanning internal networks is not allowed.`,
            resolvedIp: addr.address,
          };
        }
      }
      // If we have at least one address, treat the first as the canonical resolved IP
      if (addresses.length > 0) {
        return { safe: true, resolvedIp: addresses[0].address };
      }
      // No addresses returned — cannot verify the target is safe.
      return {
        safe: false,
        reason:
          "Domain resolved to no addresses — cannot verify target is safe to scan.",
      };
    } catch (error) {
      // DNS resolution failed — cannot verify the target resolves to a public IP,
      // so we must refuse rather than let the actual fetch resolve independently.
      return {
        safe: false,
        reason: "DNS resolution failed — cannot verify target is safe to scan.",
      };
    }
  } catch {
    return {
      safe: false,
      reason: "Invalid URL format.",
    };
  }
}

/**
 * Perform a fast, explicit check that the URL is an HTTP(S) URL pointing to a public host.
 * This is a simple syntactic guard that complements validateScanTarget's DNS/IP checks
 * and is easy for static analyzers to understand.
 */
function assertSafePublicHttpUrl(rawUrl: string): URL {
  let urlObj: URL;
  try {
    urlObj = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format");
  }

  const protocol = urlObj.protocol;
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error("Invalid protocol - only http: and https: are allowed");
  }

  const hostname = urlObj.hostname.toLowerCase();

  // Disallow blocked hostnames (including exact and subdomain matches)
  if (isBlockedHostname(hostname)) {
    throw new Error("Access to local hostnames is not allowed");
  }

  // Disallow common internal TLD-like suffixes
  for (const suffix of DISALLOWED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new Error("Access to internal hostnames is not allowed");
    }
  }

  // Optionally require at least one dot to avoid bare hostnames like "devbox"
  if (!hostname.includes(".")) {
    throw new Error("Access to unqualified hostnames is not allowed");
  }

  return urlObj;
}

/**
 * Safe fetch wrapper that validates the target before making the request
 *
 * @param url - The URL to fetch
 * @param init - Optional fetch initialization options
 * @param allowedHostnames - Optional array of hostnames that are allowed for this request.
 *                           If provided and not empty, the resolved hostname must match one of these.
 * @param session - Optional authenticated session. When supplied, its headers
 *                  are attached to every hop that stays on the session's
 *                  origin and to no other hop. A redirect that leaves the
 *                  origin therefore drops the credentials. A sign-out or
 *                  destructive URL is refused outright rather than requested
 *                  without credentials, because requesting it at all is the
 *                  problem. Session headers are recomputed per hop and are
 *                  never written back into the caller's init, so they cannot
 *                  survive into a later request.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  allowedHostnames?: string[],
  session?: ScanSessionBinding,
): Promise<Response> {
  // First perform a simple, explicit public-HTTP(S) check that is easy to reason about.
  // This ensures fetch() is never called with an obviously unsafe URL, even if callers
  // pass in untrusted data.
  const prevalidatedUrlObj = assertSafePublicHttpUrl(url);
  const normalizedUrl = prevalidatedUrlObj.href;

  // An authenticated request to a sign-out or destructive URL is refused
  // before anything else happens. Stripping the credentials would not help:
  // the scan must not walk into /logout at all.
  if (session && isSameOrigin(normalizedUrl, session.origin)) {
    const blocked = blockedForAuthenticatedRequest(normalizedUrl);
    if (blocked) throw new Error(blocked);
  }

  // If allowedHostnames is provided, enforce that the hostname matches
  if (allowedHostnames && allowedHostnames.length > 0) {
    const requestHostname = prevalidatedUrlObj.hostname.toLowerCase();
    const isAllowed = allowedHostnames.some(
      (allowed) => allowed.toLowerCase() === requestHostname,
    );
    if (!isAllowed) {
      throw new Error(`Hostname ${requestHostname} is not in the allowed list`);
    }
  }

  const safety = await validateScanTarget(normalizedUrl);

  if (!safety.safe) {
    throw new Error(safety.reason || "URL blocked for security reasons");
  }

  // We already parsed and normalized the URL in assertSafePublicHttpUrl above.
  const urlObj = prevalidatedUrlObj;

  // For HTTPS/WSS, we MUST keep the original hostname to avoid SSL/TLS certificate validation errors.
  // For HTTP/WS, we can use the resolved IP to prevent DNS rebinding attacks.
  //
  // ssrf: on the HTTPS path this leaves the rebinding window open, and the
  // branch below does NOT close it. undici re-resolves the hostname at
  // connect time, so a nameserver serving a TTL-0 record can return a public
  // address to validateScanTarget and an internal one to the socket. See
  // pinToResolvedIp's comment for the fix this needs (a per-request undici
  // Agent with a pinned connect.lookup) and why it is not here yet.
  // ref: AUDIT-012#ssrf-02
  let finalUrl = normalizedUrl;
  let finalInit: RequestInit | undefined = init;

  const isSecureProtocol =
    urlObj.protocol === "https:" || urlObj.protocol === "wss:";

  if (safety.resolvedIp && !isSecureProtocol) {
    // Only use resolved IP for HTTP (not HTTPS) to avoid cert validation issues
    const originalHostname = urlObj.hostname;
    const originalPort = urlObj.port;
    const hadExplicitPort = originalPort !== "";
    // Use URL constructor to safely build the URL with the resolved IP
    const urlWithIp = new URL(urlObj.href);
    const resolvedHostForUrl =
      isIP(safety.resolvedIp) === 6
        ? `[${safety.resolvedIp}]`
        : safety.resolvedIp;
    urlWithIp.hostname = resolvedHostForUrl;
    // After changing hostname, ensure the port matches the original URL's explicit port (if any)
    if (hadExplicitPort) {
      urlWithIp.port = originalPort;
    }
    finalUrl = urlWithIp.href;

    // Ensure the original hostname is sent in the Host header for virtual hosting
    finalInit = setHostHeader(init, originalHostname);
  } else if (isSecureProtocol && safety.resolvedIp) {
    // For HTTPS, just ensure Host header is set but keep original URL.
    // This is virtual-hosting hygiene, not an SSRF control.
    finalInit = setHostHeader(init, urlObj.hostname);
  }

  // ssrf: manual redirect loop with per-hop re-validation. We
  // deliberately set `redirect: "manual"` and walk each Location:
  // ourselves, running the same `validateScanTarget` guard on every
  // hop. Node's built-in `redirect: "follow"` blindly fetches
  // whatever URL the target returns, which allowed a public URL to
  // 302-redirect the scanner into http://169.254.169.254/ (cloud
  // metadata) or any RFC1918 address.
  //
  // Cross-host redirects are rejected outright. Same-host redirects
  // are allowed up to MAX_REDIRECT_HOPS, after which we stop and
  // return the most recent 3xx response.

  const MAX_REDIRECT_HOPS = 5;
  const controller = new AbortController();
  const timeoutMs = DEFAULT_FETCH_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  // ssrf: the deadline has to outlive this function when it hands a Response
  // back. `await fetch(...)` resolves when the response HEADERS arrive, not
  // when the body finishes, so clearing this timer (and detaching the abort
  // listeners, further down) on the way out used to hand every caller a
  // Response whose body could not be aborted by anything: a target that
  // answers with headers and then trickles one byte a minute held the read
  // open indefinitely, and a caller-supplied `signal: AbortSignal.timeout(N)`
  // silently stopped applying the moment headers landed.
  //
  // So: on a path that returns a live Response, leave the timer armed until
  // its original deadline (it aborts the body stream if the caller is still
  // reading then) and leave the combined-signal listeners attached (so the
  // caller's own signal still reaches the stream). Only a path that throws,
  // which hands back no body, clears it. `unref` keeps a pending timer from
  // holding the process open on its own.
  // ref: AUDIT-012#ssrf-01
  let handedResponseToCaller = false;

  try {
    let currentUrl = finalUrl;
    let currentInit = finalInit;
    // The URL as the target sees it. For plain HTTP, currentUrl may hold a
    // resolved IP with the real host moved into the Host header, and an
    // origin comparison against that would be meaningless. Every session
    // decision is made against this logical URL instead.
    let currentLogicalUrl = normalizedUrl;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const { signal: combinedSignal, cleanup: cleanupCombinedSignal } =
        combineAbortSignals(
          controller.signal,
          currentInit?.signal ?? undefined,
        );
      let requestInit: RequestInit = {
        ...currentInit,
        // SECURITY: never let the underlying fetch follow redirects itself.
        // We do that ourselves so we can re-validate each destination.
        redirect: "manual",
        signal: combinedSignal,
      };

      // Attach the session, if any, for this hop only. authHeadersFor
      // returns null off-origin, which is what drops the credentials on a
      // redirect that leaves the target.
      if (session) {
        const sessionHeaders = session.authHeadersFor(currentLogicalUrl);
        if (sessionHeaders) {
          requestInit = {
            ...withExtraHeaders(currentInit, sessionHeaders),
            redirect: "manual",
            signal: combinedSignal,
          };
        }
      }

      // Safe: currentUrl is re-validated by validateScanTarget on every
      // iteration of this loop. The manual redirect loop exists precisely
      // to enforce that re-validation hop-by-hop.
      // codeql[js/request-forgery]
      const response = await fetch(currentUrl, requestInit);

      // Let the session absorb cookies and notice if it has been dropped.
      // It ignores anything off its own origin.
      if (session) {
        session.observe(currentLogicalUrl, response.status, response.headers);
      }

      // Non-3xx: return as-is. The caller handles success/error semantics.
      if (response.status < 300 || response.status >= 400) {
        handedResponseToCaller = true;
        return response;
      }

      // 3xx: parse Location. If absent, return the response (browsers
      // treat this as the same URL; we don't loop forever).
      const location = response.headers.get("location");
      if (!location) {
        handedResponseToCaller = true;
        return response;
      }

      // Reached the redirect cap — return what we have so the caller
      // can decide what to do with the chain.
      if (hop === MAX_REDIRECT_HOPS) {
        handedResponseToCaller = true;
        return response;
      }

      // Resolve the Location URL against the current URL (handles
      // relative redirects). Then run the full SSRF guard on the
      // resolved absolute URL.
      let nextUrlObj: URL;
      try {
        nextUrlObj = new URL(location, currentUrl);
      } catch {
        // Invalid Location header — return the 3xx response.
        handedResponseToCaller = true;
        return response;
      }

      // Every hop passes the same syntactic gate the entry URL did. Without
      // this the scheme allowlist applied to hop 0 only, so a
      // `Location: ftp://<same-host>/x` cleared both the cross-host test
      // (identical hostname) and validateScanTarget and reached fetch(); it
      // failed only because undici does not implement ftp. Re-running the
      // gate here makes that a refusal by policy rather than by accident.
      // ref: AUDIT-012#ssrf-07
      try {
        assertSafePublicHttpUrl(nextUrlObj.href);
      } catch (err) {
        throw new Error(
          `Redirect to ${nextUrlObj.protocol}//${nextUrlObj.hostname} is not allowed: ${
            err instanceof Error ? err.message : "unsafe redirect target"
          }`,
        );
      }

      // Cross-host redirect: reject unless it's a www ↔ apex redirect on the
      // same registered domain (e.g. www.example.com → example.com). Any
      // other cross-host redirect is rejected to prevent SSRF pivoting via
      // open redirects.
      const initialHostname = prevalidatedUrlObj.hostname.toLowerCase();
      const nextHostname = nextUrlObj.hostname.toLowerCase();
      const sameRegisteredHost =
        nextHostname === initialHostname ||
        nextHostname === `www.${initialHostname}` ||
        initialHostname === `www.${nextHostname}`;
      if (!sameRegisteredHost) {
        throw new Error(
          `Redirect to a different host (${nextUrlObj.hostname}) is not allowed.`,
        );
      }

      // Same-host: re-validate the destination. This re-runs the
      // private-IP / loopback / cloud-metadata checks and the DNS
      // resolution. If the destination is now private (e.g. DNS
      // rebinding inside the same hostname), reject.
      const nextSafety = await validateScanTarget(nextUrlObj.href);
      if (!nextSafety.safe) {
        throw new Error(
          nextSafety.reason ||
            `Redirect target ${nextUrlObj.hostname} blocked for security reasons`,
        );
      }

      // An authenticated scan must not be redirected into a sign-out or a
      // destructive endpoint any more than it may be pointed at one
      // directly.
      if (session && isSameOrigin(nextUrlObj.href, session.origin)) {
        const blockedNext = blockedForAuthenticatedRequest(nextUrlObj.href);
        if (blockedNext) throw new Error(blockedNext);
      }

      // A 301, 302 or 303 becomes a GET with no body, exactly as a browser
      // does it. Without this a login POST would resend the credentials to
      // every hop of the chain.
      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303
      ) {
        currentInit = downgradeToGet(currentInit);
      }

      currentLogicalUrl = nextUrlObj.href;

      // This hop's response is being discarded for the next one, so its
      // combined signal has no stream left to guard: detach here, on the only
      // path that continues the loop. (It deliberately does NOT run on the
      // paths above that return the Response, see the timer comment.)
      if (typeof cleanupCombinedSignal === "function") {
        cleanupCombinedSignal();
      }

      // For HTTP we can keep the resolved-IP substitution; for HTTPS
      // we must keep the original hostname for cert validation.
      const isSecure =
        nextUrlObj.protocol === "https:" || nextUrlObj.protocol === "wss:";
      if (nextSafety.resolvedIp && !isSecure) {
        const urlWithIp = new URL(nextUrlObj.href);
        const host =
          isIP(nextSafety.resolvedIp) === 6
            ? `[${nextSafety.resolvedIp}]`
            : nextSafety.resolvedIp;
        urlWithIp.hostname = host;
        if (urlWithIp.port === "") {
          // preserve original port (URL strips it after hostname reassignment)
          const parsedOriginal = new URL(currentUrl);
          if (parsedOriginal.port) urlWithIp.port = parsedOriginal.port;
        }
        currentUrl = urlWithIp.href;
        currentInit = setHostHeader(currentInit, nextUrlObj.hostname);
      } else {
        currentUrl = nextUrlObj.href;
        if (isSecure) {
          currentInit = setHostHeader(currentInit, nextUrlObj.hostname);
        }
      }
    }

    // Unreachable, but TypeScript needs an exhaustible return.
    throw new Error("Unreachable: redirect loop exited without returning.");
  } finally {
    if (handedResponseToCaller) {
      // Keep the deadline armed over the body read (see above). unref is
      // Node-only and absent under a DOM-typed setTimeout, hence the guard.
      (timeoutId as unknown as { unref?: () => void }).unref?.();
    } else {
      clearTimeout(timeoutId);
    }
  }
}
