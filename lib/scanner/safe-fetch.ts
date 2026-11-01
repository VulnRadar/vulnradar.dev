/**
 * Safe Fetch Utility - SSRF Protection
 *
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises";
import {
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "net";
import { blockedForAuthenticatedRequest } from "./auth/logout-guard";
import type { ScanSessionBinding } from "./auth/types";
import { CONFIG_SCAN_FETCH_TIMEOUT_MS } from "@/lib/config/config-values";
import { SETTINGS_REGISTRY } from "@/lib/config/registry";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
// The deadline for a call that brings no signal of its own, imported rather
// than restated. The comment here used to say "keep in sync with scan route
// timeout defaults (crawl: 8s, scan routes: 15s)", which was already false:
// the crawl's per-page scan fetch was on 15s too. A comment asking a human to
// keep two numbers equal is a number that will eventually be wrong, and this
// one already was.
const DEFAULT_FETCH_TIMEOUT_MS = CONFIG_SCAN_FETCH_TIMEOUT_MS;
// The deadline for a call that DOES bring a signal. Every scan fetch passes
// `requestSignal(fetchTimeoutMs, cancelSignal)`, and `fetchTimeoutMs` is the
// admin-configurable SCAN_FETCH_TIMEOUT_MS. safeFetch used to arm its own
// compiled 15s timer next to it and let whichever fired first win, so the
// setting could lower the timeout but never raise it: an admin who lifted it
// to 60s for a slow target still got "This operation was aborted" at 15s.
// With a caller signal the caller's deadline governs and this is only the
// backstop for a signal that carries no deadline of its own, held at the
// setting's registry maximum so no configured value can ever exceed it.
const CALLER_GOVERNED_BACKSTOP_MS = SETTINGS_REGISTRY.SCAN_FETCH_TIMEOUT_MS.max;

export type SafeFetchErrorCode =
  | "cross_host_redirect"
  | "timeout"
  | "tls"
  | "unreachable"
  | "blocked"
  | "redirect";

/**
 * What safeFetch throws when it knows why a request did not happen.
 *
 * The scan pipeline used to store `error.message` and nothing else, and every
 * message that mattered was wrong by the time it got there: undici's reason
 * for a refused connection, a failed handshake or an unresolvable name is on
 * `err.cause.code` while the message is the unhelpful `fetch failed`, and a
 * redirect to another host was a sentence to be pattern-matched. A code is
 * the structured answer. Callers read `code`, `redirectHost` and `cause`
 * without importing this class (the check is `err.code === "timeout"`), so
 * the shape is a contract: add codes, never rename one.
 *
 * - `cross_host_redirect`: the target answered, but sent us to another host.
 *   `redirectHost` names it.
 * - `timeout`: the deadline fired, or the connect timed out.
 * - `tls`: the certificate or handshake was refused.
 * - `unreachable`: refused, reset, no route, or the name did not resolve.
 * - `blocked`: safeFetch refused to make the request at all (private address,
 *   internal hostname, bad scheme, outside the allow-list, sign-out URL).
 * - `redirect`: the caller passed `redirect: "error"` and the target answered
 *   with a redirect. `redirectHost` names where it pointed, when it said.
 *
 * The message is whatever the underlying failure already said. Wrapping must
 * not reword it: stored error text and the sanitizer in
 * lib/api/scan-error-message.ts both match on it.
 */
export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly redirectHost?: string;

  constructor(
    message: string,
    code: SafeFetchErrorCode,
    options?: { cause?: unknown; redirectHost?: string },
  ) {
    super(
      message,
      options?.cause !== undefined ? { cause: options.cause } : {},
    );
    this.name = "SafeFetchError";
    this.code = code;
    if (options?.redirectHost !== undefined) {
      this.redirectHost = options.redirectHost;
    }
  }
}

// undici and Node report a certificate or handshake failure on `cause.code`.
// EPROTO is the errno wrapper OpenSSL's own failures come through.
const TLS_ERROR_CODE =
  /^(CERT_|ERR_CERT|ERR_TLS|ERR_SSL|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT|EPROTO$)/;
const TIMEOUT_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);
const UNREACHABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
]);

/**
 * Every string `code` on an error and the errors it wraps. undici puts the
 * socket error on `cause`, and a dual-stack connect puts one per address on
 * an AggregateError's `errors`. A DOMException's `code` is a number and is
 * skipped by the typeof check.
 */
function errorCodes(err: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<unknown>();
  const walk = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || seen.has(e) || depth > 4) return;
    seen.add(e);
    const { code, cause, errors } = e as {
      code?: unknown;
      cause?: unknown;
      errors?: unknown;
    };
    if (typeof code === "string") codes.push(code);
    walk(cause, depth + 1);
    if (Array.isArray(errors)) {
      for (const inner of errors) walk(inner, depth + 1);
    }
  };
  walk(err, 0);
  return codes;
}

function isTimeoutReason(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: unknown }).name === "TimeoutError"
  );
}

/**
 * Tag a failure from `fetch` itself with its class, or return null when it is
 * none of the five (a user cancel aborts with an AbortError and must reach
 * the caller untouched, as must anything the engine does not understand).
 *
 * `signal` is the one the request ran under. fetch rejects with the signal's
 * reason, but reading it back from the signal as well keeps this correct on
 * an undici that wraps the reason in a generic AbortError.
 */
function classifyFetchFailure(
  err: unknown,
  signal: AbortSignal,
): SafeFetchError | null {
  // A refusal from the pinned dispatcher reaches us wrapped in undici's
  // "fetch failed". It is already the answer.
  const cause = (err as { cause?: unknown } | null)?.cause;
  if (cause instanceof SafeFetchError) return cause;

  const message = err instanceof Error ? err.message : String(err);

  if (
    (signal.aborted && isTimeoutReason(signal.reason)) ||
    isTimeoutReason(err)
  ) {
    return new SafeFetchError(message, "timeout", { cause: err });
  }

  const codes = errorCodes(err);
  if (codes.some((c) => TLS_ERROR_CODE.test(c))) {
    return new SafeFetchError(message, "tls", { cause: err });
  }
  if (codes.some((c) => TIMEOUT_ERROR_CODES.has(c))) {
    return new SafeFetchError(message, "timeout", { cause: err });
  }
  if (codes.some((c) => UNREACHABLE_ERROR_CODES.has(c))) {
    return new SafeFetchError(message, "unreachable", { cause: err });
  }
  return null;
}

/** The error for a validateScanTarget refusal, keeping its reason verbatim. */
function refusalFrom(
  safety: SafetyCheckResult,
  fallbackReason: string,
): SafeFetchError {
  return new SafeFetchError(
    safety.reason || fallbackReason,
    safety.code ?? "blocked",
    { cause: safety.cause },
  );
}

/**
 * Make `response.url` the URL of the hop that answered. fetch already reports
 * it now that the URL keeps its hostname, but the contract is older than that
 * (plain HTTP used to be fetched by IP, and every caller comparing
 * `response.url` to the URL it asked for read the IP as a redirect), and a
 * Response that did not come from undici carries no url at all.
 * `url` is a getter on Response.prototype; an own property shadows it.
 */
function withLogicalUrl(response: Response, logicalUrl: string): Response {
  Object.defineProperty(response, "url", {
    value: logicalUrl,
    enumerable: true,
    configurable: true,
  });
  return response;
}

// Basic hostname patterns we never want to scan directly, regardless of DNS resolution.
// These are a fast, syntactic safeguard that complements validateScanTarget's IP-based checks.
const DISALLOWED_HOSTNAMES = ["localhost"];
const DISALLOWED_HOSTNAME_SUFFIXES = [".local", ".internal", ".lan"];

/**
 * Combine a required timeout signal with an optional caller-provided signal so that
 * the returned signal aborts when either source signal aborts.
 *
 * The combined signal aborts WITH the source's reason. `controller.abort()`
 * with no argument made every abort an AbortError, which threw away the
 * TimeoutError a deadline carries and left every page timeout stored as "This
 * operation was aborted". With the reason forwarded, a deadline stays a
 * TimeoutError and a user cancel stays an AbortError, and the difference is
 * readable by whoever catches the rejection.
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
    controller.abort(
      timeoutSignal.aborted ? timeoutSignal.reason : callerSignal.reason,
    );
    return { signal: controller.signal, cleanup: undefined };
  }

  const controller = new AbortController();

  const forwardAbortFrom = (source: AbortSignal) => () => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };
  const onTimeoutAbort = forwardAbortFrom(timeoutSignal);
  const onCallerAbort = forwardAbortFrom(callerSignal);

  timeoutSignal.addEventListener("abort", onTimeoutAbort, { once: true });
  callerSignal.addEventListener("abort", onCallerAbort, { once: true });

  const cleanup = () => {
    timeoutSignal.removeEventListener("abort", onTimeoutAbort);
    callerSignal.removeEventListener("abort", onCallerAbort);
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
  // ssrf: Azure's WireServer. 168.63.129.16 is a public address Microsoft
  // owns, and from inside an Azure VM it answers as the host: WireServer on
  // :80 and the HostGAPlugin on :32526 (/vmSettings, /machine?comp=goalstate)
  // hand out VM configuration, extension settings and certificates. No
  // private range covers it, so an Azure-hosted instance read it for anyone
  // who scanned it. One address, not a range: the rest of 168.63.0.0/16 is
  // ordinary Microsoft space. The IPv4-mapped path below inherits it.
  /^168\.63\.129\.16$/,
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
  /**
   * Set on a refusal, and it is what safeFetch's thrown error carries. A name
   * that does not resolve is "unreachable": the target is down or mistyped,
   * and the guard refuses it only because it cannot prove the address is
   * public. Everything else (scheme, private range, internal hostname) is
   * "blocked".
   */
  code?: "blocked" | "unreachable";
  /** The resolver's own error, when DNS is why the target was refused. */
  cause?: unknown;
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
 * If `canonicalIp` carries an IPv4 address in a form a network can still
 * deliver to that IPv4 host, return the embedded IPv4 in dotted form:
 * IPv4-mapped (::ffff:a.b.c.d), the deprecated IPv4-compatible form
 * (::a.b.c.d, RFC 4291 2.5.5.1), RFC 6052 NAT64 (64:ff9b::a.b.c.d) and 6to4
 * (2002:aabb:ccdd::/48, RFC 3056). Returns null otherwise.
 *
 * The compatible and 6to4 forms used to fall through to the native IPv6
 * patterns, which match neither, so a DNS answer of ::7f00:1 or
 * 2002:a9fe:a9fe:: passed as public on a host whose network routes them.
 */
function ipv4MappedToDotted(canonicalIp: string): string | null {
  const groups = canonicalIp.split(":");
  if (groups.length !== 8) return null;

  // IPv4-mapped IPv6: ::ffff:X.X.X.X → groups[0..4] = 0, groups[5] = ffff.
  // IPv4-compatible: ::X.X.X.X → groups[0..5] = 0.
  if (
    groups[0] === "0000" &&
    groups[1] === "0000" &&
    groups[2] === "0000" &&
    groups[3] === "0000" &&
    groups[4] === "0000" &&
    (groups[5] === "ffff" || groups[5] === "0000")
  ) {
    return hexGroupPairToDotted(groups[6], groups[7]);
  }

  // 6to4: 2002:XXXX:XXXX::/48, the IPv4 in the two groups after the prefix.
  if (groups[0] === "2002") {
    return hexGroupPairToDotted(groups[1], groups[2]);
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

// ── Pinning the socket ──────────────────────────────────────────────────────
//
// ssrf: validateScanTarget approves an address, and the request has to go to
// THAT address. Pinning used to mean rewriting the URL to the IP, which was
// wrong both ways. On plain HTTP undici sent the IP as the Host header (it
// derives Host from the URL and drops one set by hand), so a target behind a
// CDN or a name-based vhost answered as some other site and its findings were
// stored as the target's. On HTTPS the URL kept its name because the
// certificate needs it, and undici resolved that name again at connect time,
// so a nameserver answering TTL-0 could hand validateScanTarget a public
// address and the socket an internal one: the private-range list was advisory
// and every user had a port-state oracle on the hosting network.
//
// Now the URL keeps its hostname and fetch is handed a dispatcher that opens
// the socket itself with node:http/https: `host` is the approved address, so
// nothing resolves the name again, the Host header is the URL's host and port,
// and on HTTPS `servername` carries the name for SNI and the certificate
// check. That is the same split checks/tls.ts and tls-handshake.ts already
// make (host: safeIp plus servername). A `dispatcher` on the init is how
// fetch takes a custom connection without the `undici` package as a
// dependency. ref: AUDIT-012#ssrf-02, sec-outbound-1, sec-outbound-3

/**
 * The part of undici's Dispatcher contract fetch drives (docs/api/Dispatcher.md
 * in undici 6, the version Node 22 bundles). Spelled out here because its
 * types ship with the `undici` package, which this repo does not depend on.
 * tests/lib/scanner/safe-fetch-pinning.test.ts runs the real fetch through it,
 * so a runtime whose fetch speaks a different contract fails there first.
 */
interface DispatchOptions {
  origin?: string | URL;
  path: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined> | string[] | null;
  body?: string | Uint8Array | AsyncIterable<Uint8Array> | null;
}

interface DispatchHandler {
  onConnect?(abort: (reason?: unknown) => void): void;
  onResponseStarted?(): void;
  onHeaders?(
    statusCode: number,
    rawHeaders: Buffer[],
    resume: () => void,
    statusText: string,
  ): boolean | void;
  onData?(chunk: Buffer): boolean | void;
  onComplete?(trailers: Buffer[] | null): void;
  onError?(err: Error): void;
}

function asError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException("The operation was aborted.", "AbortError");
}

function outgoingHeaders(raw: DispatchOptions["headers"]): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  if (!raw) return out;
  const add = (name: string, value: string | string[]) => {
    const key = name.toLowerCase();
    const prev = out[key];
    out[key] =
      prev === undefined ? value : ([] as string[]).concat(String(prev), value);
  };
  if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) add(raw[i], raw[i + 1]);
  } else {
    for (const [name, value] of Object.entries(raw)) {
      if (value !== undefined) add(name, value);
    }
  }
  return out;
}

async function writeStreamedBody(
  req: ReturnType<typeof httpRequest>,
  body: AsyncIterable<Uint8Array>,
): Promise<void> {
  try {
    for await (const chunk of body) {
      if (req.destroyed) return;
      if (!req.write(chunk)) {
        // Whichever fires first, the other listener goes too. Left behind,
        // one per wait piled up on the request until a long upload tripped
        // MaxListenersExceededWarning.
        await new Promise<void>((resolve) => {
          const done = () => {
            req.off("drain", done);
            req.off("close", done);
            resolve();
          };
          req.once("drain", done);
          req.once("close", done);
        });
      }
    }
    if (!req.destroyed) req.end();
  } catch (err) {
    req.destroy(asError(err));
  }
}

/**
 * A fetch dispatcher whose every socket goes to one approved address, for one
 * hostname. A request for any other host is refused rather than sent there:
 * the address was approved for this name only, and a fetch told to follow
 * redirects would otherwise carry it over to wherever the target pointed.
 */
export class PinnedDispatcher {
  constructor(
    readonly hostname: string,
    readonly address: string,
  ) {}

  dispatch(opts: DispatchOptions, handler: DispatchHandler): boolean {
    try {
      this.send(opts, handler);
    } catch (err) {
      queueMicrotask(() => handler.onError?.(asError(err)));
    }
    return true;
  }

  private send(opts: DispatchOptions, handler: DispatchHandler): void {
    const origin = new URL(String(opts.origin));
    if (
      origin.hostname !== this.hostname ||
      !ALLOWED_PROTOCOLS.has(origin.protocol)
    ) {
      throw new SafeFetchError(
        `Redirect to a different host (${origin.hostname}) is not allowed.`,
        "cross_host_redirect",
        { redirectHost: origin.hostname },
      );
    }

    const secure = origin.protocol === "https:";
    const bareHost = origin.hostname.replace(/^\[(.*)\]$/, "$1");
    const headers = outgoingHeaders(opts.headers);
    // Host is the URL's, port included, never the address. fetch drops a
    // Host the caller set by hand before it gets here, so there is no
    // caller value to keep.
    headers.host = origin.host;

    const req = (secure ? httpsRequest : httpRequest)({
      host: this.address,
      port: origin.port ? Number(origin.port) : secure ? 443 : 80,
      path: opts.path,
      method: opts.method ?? "GET",
      headers,
      // SNI and the certificate check name the host. An IP-literal URL has no
      // name to send and is checked against the certificate's IP entries.
      ...(secure && isIP(bareHost) === 0 ? { servername: bareHost } : {}),
    });

    let settled = false;
    let response: IncomingMessage | undefined;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      handler.onError?.(err);
    };

    req.on("error", fail);
    req.on("response", (res) => {
      response = res;
      handler.onResponseStarted?.();
      const rawHeaders = res.rawHeaders.map((v) => Buffer.from(v, "latin1"));
      const flowing = handler.onHeaders?.(
        res.statusCode ?? 0,
        rawHeaders,
        () => res.resume(),
        res.statusMessage ?? "",
      );
      if (flowing === false) res.pause();
      res.on("data", (chunk: Buffer) => {
        if (handler.onData?.(chunk) === false) res.pause();
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        handler.onComplete?.(
          res.rawTrailers.map((v) => Buffer.from(v, "latin1")),
        );
      });
      res.on("error", fail);
      res.on("close", () => {
        if (!res.complete) {
          fail(
            Object.assign(new Error("other side closed"), {
              code: "UND_ERR_SOCKET",
            }),
          );
        }
      });
    });

    handler.onConnect?.((reason) => {
      const err = asError(reason);
      response?.destroy(err);
      req.destroy(err);
      fail(err);
    });
    if (req.destroyed) return;

    const body = opts.body;
    if (body == null) {
      req.end();
    } else if (typeof body === "string" || body instanceof Uint8Array) {
      req.end(body);
    } else {
      void writeStreamedBody(req, body);
    }
  }
}

/** A RequestInit fetch will send through a PinnedDispatcher. */
export type PinnedRequestInit = RequestInit & { dispatcher: PinnedDispatcher };

function pinnedInit(
  init: RequestInit | undefined,
  hostname: string,
  address: string,
): PinnedRequestInit {
  return { ...init, dispatcher: new PinnedDispatcher(hostname, address) };
}

/**
 * Pin a request for `url` to the address a prior validateScanTarget approved,
 * for a caller that calls fetch itself. The URL comes back unchanged and the
 * init carries the dispatcher, so `fetch(target.url, target.init)` connects to
 * `resolvedIp` and nowhere else, with the hostname in Host and SNI. Pass the
 * `resolvedIp` from the SafetyCheckResult the url was validated with.
 *
 * Unlike safeFetch this does NOT touch redirect handling, so a probe that
 * needs to inspect a raw cross-host 3xx (the open-redirect canary) keeps
 * working. A fetch told to follow keeps every hop on this host and address,
 * and fails a hop to any other host instead of resolving it.
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
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { url, init };
  return { url, init: pinnedInit(init, parsed.hostname, resolvedIp) };
}

/**
 * The allow-list check, for the entry URL and every redirect hop alike. The
 * message is stored and shown as is (ux-copy-14), so it does not change.
 */
function assertAllowedHostname(
  hostname: string,
  allowedHostnames: string[] | undefined,
): void {
  if (!allowedHostnames || allowedHostnames.length === 0) return;
  const requested = hostname.toLowerCase();
  if (!allowedHostnames.some((a) => a.toLowerCase() === requested)) {
    throw new SafeFetchError(
      `Hostname ${requested} is not in the allowed list`,
      "blocked",
    );
  }
}

/** The statuses fetch itself treats as a redirect (Fetch standard). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  if (method === "GET" || method === "HEAD") return { ...init };
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
        code: "blocked",
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
          code: "blocked",
        };
      }
      return { safe: true, resolvedIp: hostname };
    }

    // Check blocked hostnames
    if (isBlockedHostname(hostname)) {
      return {
        safe: false,
        reason: `Scanning internal hostnames (${hostname}) is not allowed for security reasons.`,
        code: "blocked",
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
            code: "blocked",
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
        code: "unreachable",
      };
    } catch (error) {
      // DNS resolution failed — cannot verify the target resolves to a public IP,
      // so we must refuse rather than let the actual fetch resolve independently.
      return {
        safe: false,
        reason: "DNS resolution failed — cannot verify target is safe to scan.",
        code: "unreachable",
        cause: error,
      };
    }
  } catch {
    return {
      safe: false,
      reason: "Invalid URL format.",
      code: "blocked",
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
    throw new SafeFetchError("Invalid URL format", "blocked");
  }

  const protocol = urlObj.protocol;
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new SafeFetchError(
      "Invalid protocol - only http: and https: are allowed",
      "blocked",
    );
  }

  const hostname = urlObj.hostname.toLowerCase();

  // Disallow blocked hostnames (including exact and subdomain matches)
  if (isBlockedHostname(hostname)) {
    throw new SafeFetchError(
      "Access to local hostnames is not allowed",
      "blocked",
    );
  }

  // Disallow common internal TLD-like suffixes
  for (const suffix of DISALLOWED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new SafeFetchError(
        "Access to internal hostnames is not allowed",
        "blocked",
      );
    }
  }

  // Optionally require at least one dot to avoid bare hostnames like "devbox"
  if (!hostname.includes(".")) {
    throw new SafeFetchError(
      "Access to unqualified hostnames is not allowed",
      "blocked",
    );
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
 *
 * Every hop is fetched by its hostname on a socket pinned to the address
 * validateScanTarget approved for that hop (see PinnedDispatcher), so DNS is
 * never consulted again between the check and the connect. The returned
 * Response's `url` is the final hop's URL. Every refusal and network failure
 * is a SafeFetchError carrying a `code`; an abort the caller asked for (a
 * cancelled scan) and anything unrecognised are rethrown as they came.
 *
 * Redirects: safeFetch follows them itself, re-validating every hop, and
 * `allowedHostnames` applies to every hop, not only the first. `init.redirect`
 * is honoured for one value: `"error"` makes the first redirect (301, 302,
 * 303, 307 or 308) throw a SafeFetchError with code `redirect` instead of
 * being followed, which is what a caller that must not follow one (an
 * MTA-STS policy fetch, RFC 8461) asks for. Any other 3xx comes back as the
 * answer and is never followed in that mode, even when it names a Location.
 * `"follow"` and `"manual"` both get the guarded loop.
 *
 * Deadline: with `init.signal` the caller's deadline governs (the internal
 * timer is only a backstop, see CALLER_GOVERNED_BACKSTOP_MS). Without one the
 * request is cut off after the 15s default.
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
    if (blocked) throw new SafeFetchError(blocked, "blocked");
  }

  assertAllowedHostname(prevalidatedUrlObj.hostname, allowedHostnames);

  const safety = await validateScanTarget(normalizedUrl);

  // validateScanTarget names the address on every approval. Without one there
  // is nothing to pin the socket to, and an unpinned socket resolves the name
  // again, so that is a refusal too.
  if (!safety.safe || !safety.resolvedIp) {
    throw refusalFrom(safety, "URL blocked for security reasons");
  }

  const refuseRedirects = init?.redirect === "error";

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
  // A caller that brings a signal owns the deadline (see
  // CALLER_GOVERNED_BACKSTOP_MS); one that does not gets the 15s default.
  const timeoutMs =
    init?.signal != null
      ? CALLER_GOVERNED_BACKSTOP_MS
      : DEFAULT_FETCH_TIMEOUT_MS;
  // Same name and wording as the reason AbortSignal.timeout() aborts with, so
  // a deadline reads identically whichever side's timer fired.
  const timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      ),
    );
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
    let currentInit = init;
    // The URL of this hop, by name. It is what fetch is given, what the
    // session decides scope against and what Location resolves against.
    let currentLogicalUrl = normalizedUrl;
    // The address validateScanTarget approved for this hop's host.
    let currentAddress = safety.resolvedIp;

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const { signal: combinedSignal, cleanup: cleanupCombinedSignal } =
        combineAbortSignals(
          controller.signal,
          currentInit?.signal ?? undefined,
        );
      // Attach the session, if any, for this hop only. authHeadersFor
      // returns null off-origin, which is what drops the credentials on a
      // redirect that leaves the target.
      const sessionHeaders = session?.authHeadersFor(currentLogicalUrl);
      const requestInit: PinnedRequestInit = {
        ...pinnedInit(
          sessionHeaders
            ? withExtraHeaders(currentInit, sessionHeaders)
            : currentInit,
          new URL(currentLogicalUrl).hostname,
          currentAddress,
        ),
        // SECURITY: never let the underlying fetch follow redirects itself.
        // We do that ourselves so we can re-validate each destination.
        redirect: "manual",
        signal: combinedSignal,
      };

      // Safe: currentLogicalUrl is re-validated by validateScanTarget on
      // every iteration of this loop, and the dispatcher connects to the
      // address that validation approved and to nothing else.
      let response: Response;
      try {
        // codeql[js/request-forgery]
        response = await fetch(currentLogicalUrl, requestInit);
      } catch (err) {
        throw classifyFetchFailure(err, combinedSignal) ?? err;
      }

      // Let the session absorb cookies and notice if it has been dropped.
      // It ignores anything off its own origin.
      if (session) {
        session.observe(currentLogicalUrl, response.status, response.headers);
      }

      // The caller said not to follow redirects: the first one is the answer.
      if (refuseRedirects && REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        let redirectHost: string | undefined;
        try {
          if (location) {
            redirectHost = new URL(location, currentLogicalUrl).hostname;
          }
        } catch {
          // An unparseable Location still refuses; it just names no host.
        }
        await response.body?.cancel().catch(() => {});
        throw new SafeFetchError(
          `The target answered HTTP ${response.status}, and this request does not follow redirects.`,
          "redirect",
          redirectHost ? { redirectHost } : undefined,
        );
      }

      // Non-3xx: return as-is. The caller handles success/error semantics.
      // Under redirect: "error" the 3xx statuses fetch does not count as a
      // redirect (a 300, a 304) are returned as-is too, as fetch returns
      // them. The loop below follows any 3xx that names a Location, so
      // without this a same-host 300 was followed for a caller that asked
      // for no redirects at all.
      if (refuseRedirects || response.status < 300 || response.status >= 400) {
        handedResponseToCaller = true;
        return withLogicalUrl(response, currentLogicalUrl);
      }

      // 3xx: parse Location. If absent, return the response (browsers
      // treat this as the same URL; we don't loop forever).
      const location = response.headers.get("location");
      if (!location) {
        handedResponseToCaller = true;
        return withLogicalUrl(response, currentLogicalUrl);
      }

      // Reached the redirect cap — return what we have so the caller
      // can decide what to do with the chain.
      if (hop === MAX_REDIRECT_HOPS) {
        handedResponseToCaller = true;
        return withLogicalUrl(response, currentLogicalUrl);
      }

      // Resolve the Location URL against the URL the target sees (handles
      // relative redirects). Then run the full SSRF guard on the resolved
      // absolute URL. (When plain HTTP was fetched by IP, resolving against
      // the dialled URL turned `Location: /next` into `http://<ip>/next` and
      // the cross-host test below read the IP as a different host.)
      let nextUrlObj: URL;
      try {
        nextUrlObj = new URL(location, currentLogicalUrl);
      } catch {
        // Invalid Location header — return the 3xx response.
        handedResponseToCaller = true;
        return withLogicalUrl(response, currentLogicalUrl);
      }

      // From here this hop's Response is either followed or refused, never
      // returned, so nobody will read its body. Release the connection now:
      // the pinned dispatcher runs on node:http, which has no body timeout,
      // and a target answering 3xx with a body that never ends would
      // otherwise hold one socket per hop open until the Response is
      // collected.
      await response.body?.cancel().catch(() => {});

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
        throw new SafeFetchError(
          `Redirect to ${nextUrlObj.protocol}//${nextUrlObj.hostname} is not allowed: ${
            err instanceof Error ? err.message : "unsafe redirect target"
          }`,
          "blocked",
          { cause: err },
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
        throw new SafeFetchError(
          `Redirect to a different host (${nextUrlObj.hostname}) is not allowed.`,
          "cross_host_redirect",
          { redirectHost: nextUrlObj.hostname },
        );
      }

      // The www <-> apex hop above is a courtesy for ordinary scans. A caller
      // that confined the request to a list of hosts (every active probe)
      // meant the list, on every hop. ref: AUDIT-012#ssrf-09
      assertAllowedHostname(nextUrlObj.hostname, allowedHostnames);

      // Same-host: re-validate the destination. This re-runs the
      // private-IP / loopback / cloud-metadata checks and the DNS
      // resolution. If the destination is now private (e.g. DNS
      // rebinding inside the same hostname), reject.
      const nextSafety = await validateScanTarget(nextUrlObj.href);
      if (!nextSafety.safe || !nextSafety.resolvedIp) {
        throw refusalFrom(
          nextSafety,
          `Redirect target ${nextUrlObj.hostname} blocked for security reasons`,
        );
      }

      // An authenticated scan must not be redirected into a sign-out or a
      // destructive endpoint any more than it may be pointed at one
      // directly.
      if (session && isSameOrigin(nextUrlObj.href, session.origin)) {
        const blockedNext = blockedForAuthenticatedRequest(nextUrlObj.href);
        if (blockedNext) throw new SafeFetchError(blockedNext, "blocked");
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

      // The next hop is fetched by its own URL (port included, so a Location
      // that names no port goes to the scheme's default) on a socket pinned
      // to the address just approved for it.
      currentLogicalUrl = nextUrlObj.href;
      currentAddress = nextSafety.resolvedIp;

      // This hop's response is being discarded for the next one, so its
      // combined signal has no stream left to guard: detach here, on the only
      // path that continues the loop. (It deliberately does NOT run on the
      // paths above that return the Response, see the timer comment.)
      if (typeof cleanupCombinedSignal === "function") {
        cleanupCombinedSignal();
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
