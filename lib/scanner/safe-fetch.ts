/**
 * Safe Fetch Utility - SSRF Protection
 *
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";

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
];

// IPv6 private/special ranges.
// Patterns are tested against the canonical 8-group form returned by
// toCanonicalIPv6() below (e.g. "0000:0000:0000:0000:0000:0000:0000:0001"
// for "::1"). Shorthand forms (::1, fc00::1) are normalised first, so
// these regexes need to match the expanded 8-group form.
const PRIVATE_IPV6_PATTERNS = [
  /^0000:0000:0000:0000:0000:0000:0000:0001$/i, // IPv6 loopback (::1)
  /^fe80:/i, // IPv6 link-local (fe80::/10)
  /^fc00:/i, // IPv6 unique local (ULA) (fc00::/7)
  /^fd[0-9a-f]{2}:/i, // IPv6 unique local (ULA) (fd00::/8)
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
  /^fec0:/i, // IPv6 site-local (deprecated RFC 3879)
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
 */
export async function validateScanTarget(
  url: string,
): Promise<SafetyCheckResult> {
  try {
    const parsed = new URL(url);
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
      // No addresses returned; treat as safe but without a resolved IP
      return { safe: true };
    } catch (error) {
      // DNS resolution failed - let the actual fetch handle it
      return { safe: true };
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
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  allowedHostnames?: string[],
): Promise<Response> {
  // First perform a simple, explicit public-HTTP(S) check that is easy to reason about.
  // This ensures fetch() is never called with an obviously unsafe URL, even if callers
  // pass in untrusted data.
  const prevalidatedUrlObj = assertSafePublicHttpUrl(url);
  const normalizedUrl = prevalidatedUrlObj.href;

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
    // For HTTPS, just ensure Host header is set but keep original URL
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

  try {
    let currentUrl = finalUrl;
    let currentInit = finalInit;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const { signal: combinedSignal, cleanup: cleanupCombinedSignal } =
        combineAbortSignals(
          controller.signal,
          currentInit?.signal ?? undefined,
        );
      const requestInit: RequestInit = {
        ...currentInit,
        // SECURITY: never let the underlying fetch follow redirects itself.
        // We do that ourselves so we can re-validate each destination.
        redirect: "manual",
        signal: combinedSignal,
      };

      // codeql[js/request-forgery]
      // linter suppress: CodeQL js/request-forgery flags this fetch
      // because currentUrl is interpolated into a fetch call. The
      // variable was just re-validated by validateScanTarget in this
      // loop iteration (and the previous iteration, and the one
      // before, etc). The whole point of the manual redirect loop is
      // to enforce that re-validation. Safe to suppress.
      const response = await fetch(currentUrl, requestInit);
      if (typeof cleanupCombinedSignal === "function") {
        cleanupCombinedSignal();
      }

      // Non-3xx: return as-is. The caller handles success/error semantics.
      if (response.status < 300 || response.status >= 400) {
        return response;
      }

      // 3xx: parse Location. If absent, return the response (browsers
      // treat this as the same URL; we don't loop forever).
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }

      // Reached the redirect cap — return what we have so the caller
      // can decide what to do with the chain.
      if (hop === MAX_REDIRECT_HOPS) {
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
        return response;
      }

      // Cross-host redirect: REJECT outright. The initial URL's hostname
      // is the trust boundary. If the target tries to redirect to a
      // different public host, that's almost always an open-redirect
      // being abused for SSRF pivoting.
      const initialHostname = prevalidatedUrlObj.hostname.toLowerCase();
      if (nextUrlObj.hostname.toLowerCase() !== initialHostname) {
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
    clearTimeout(timeoutId);
  }
}
