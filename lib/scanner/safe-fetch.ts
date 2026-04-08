/**
 * Safe Fetch Utility - SSRF Protection
 * 
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises"
import { isIP } from "net"

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])
// Keep in sync with scan route timeout defaults (crawl: 8s, scan routes: 15s)
// safeFetch enforces a 15s max to align with most scan operations
const DEFAULT_FETCH_TIMEOUT_MS = 15000

// Basic hostname patterns we never want to scan directly, regardless of DNS resolution.
// These are a fast, syntactic safeguard that complements validateScanTarget's IP-based checks.
const DISALLOWED_HOSTNAMES = [
  "localhost",
]
const DISALLOWED_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
  ".lan",
]

/**
 * Combine a required timeout signal with an optional caller-provided signal so that
 * the returned signal aborts when either source signal aborts.
 */
function combineAbortSignals(
  timeoutSignal: AbortSignal,
  callerSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: (() => void) | undefined } {
  if (!callerSignal) {
    return { signal: timeoutSignal, cleanup: undefined }
  }

  // If either signal is already aborted, return a signal in the aborted state.
  if (timeoutSignal.aborted || callerSignal.aborted) {
    const controller = new AbortController()
    controller.abort()
    return { signal: controller.signal, cleanup: undefined }
  }

  const controller = new AbortController()

  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  timeoutSignal.addEventListener("abort", onAbort, { once: true })
  callerSignal.addEventListener("abort", onAbort, { once: true })

  const cleanup = () => {
    timeoutSignal.removeEventListener("abort", onAbort)
    callerSignal.removeEventListener("abort", onAbort)
  }

  return { signal: controller.signal, cleanup }
}

// IPv4 private ranges (RFC 1918 + special ranges)
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Private A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private B (172.16.0.0/12)
  /^192\.168\./,                     // Private C (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^2(2[4-9]|3[0-9])\./,             // Multicast (224.0.0.0/4 = 224-239.x.x.x)
  /^(24[0-9]|25[0-4])\./,            // Reserved first octet range 240-254 (255 handled separately below)
  /^255\./,                          // Broadcast
]

// IPv6 private/special ranges
const PRIVATE_IPV6_PATTERNS = [
  /^::1$/,                           // IPv6 loopback
  /^fe80:/i,                         // IPv6 link-local
  /^fc00:/i,                         // IPv6 unique local (ULA)
  /^fd[0-9a-f]{2}:/i,                // IPv6 unique local (ULA)
  /^::$/,                            // Unspecified
  /^::ffff:127\./i,                  // IPv4-mapped loopback
  /^::ffff:10\./i,                   // IPv4-mapped private A
  /^::ffff:172\.(1[6-9]|2[0-9]|3[0-1])\./i,  // IPv4-mapped private B
  /^::ffff:192\.168\./i,             // IPv4-mapped private C
]

export interface SafetyCheckResult {
  safe: boolean
  reason?: string
  resolvedIp?: string
}

/**
 * Check if an IP address is in a private/internal range
 */
export function isPrivateIP(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    // Apply IPv4 private and special-range checks
    return PRIVATE_IPV4_PATTERNS.some(pattern => pattern.test(ip))
  }
  if (version === 6) {
    // Apply IPv6 private and special-range checks
    return PRIVATE_IPV6_PATTERNS.some(pattern => pattern.test(ip))
  }
  // Not a valid IP address: treat as unsafe/private to avoid bypassing checks
  return true
}

/**
 * Helper function to set the Host header while preserving existing headers
 */
function setHostHeader(init: RequestInit | undefined, hostname: string): RequestInit {
  const existingInit = init || {}
  const existingHeaders = existingInit.headers
  let headers: HeadersInit

  if (existingHeaders) {
    if (Array.isArray(existingHeaders)) {
      headers = [...existingHeaders, ["Host", hostname]]
    } else if (existingHeaders instanceof Headers) {
      const newHeaders = new Headers(existingHeaders)
      newHeaders.set("Host", hostname)
      headers = newHeaders
    } else {
      headers = { ...existingHeaders, Host: hostname }
    }
  } else {
    headers = { Host: hostname }
  }

  return { ...existingInit, headers }
}

/**
 * Check if a hostname is blocked
 */
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "")
  const hostLabels = lower.split(".").filter(Boolean)
  const matchesBlockedHostname = DISALLOWED_HOSTNAMES.some(blocked => {
    const blockedLabels = blocked.toLowerCase().split(".").filter(Boolean)

    if (hostLabels.length < blockedLabels.length) return false

    for (let i = 1; i <= blockedLabels.length; i++) {
      if (hostLabels[hostLabels.length - i] !== blockedLabels[blockedLabels.length - i]) {
        return false
      }
    }

    return true
  })
  const matchesBlockedSuffix = DISALLOWED_HOSTNAME_SUFFIXES.some(suffix =>
    lower.endsWith(suffix)
  )
  return matchesBlockedHostname || matchesBlockedSuffix
}

/**
 * Validate a URL for safe scanning
 * Returns safety status and reason if blocked
 */
export async function validateScanTarget(url: string): Promise<SafetyCheckResult> {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    
    // Check if hostname is an IP address (IPv4 or IPv6)
    const ipVersion = isIP(hostname)
    if (ipVersion !== 0) {
      // Direct IP address - check if private
      if (isPrivateIP(hostname)) {
        return {
          safe: false,
          reason: `Scanning internal/private IP addresses is not allowed for security reasons.`,
        }
      }
      return { safe: true, resolvedIp: hostname }
    }
    
    // Check blocked hostnames
    if (isBlockedHostname(hostname)) {
      return {
        safe: false,
        reason: `Scanning internal hostnames (${hostname}) is not allowed for security reasons.`,
      }
    }
    
    // Resolve hostname to IP and check
    try {
      const addresses = await lookup(hostname, { all: true })
      for (const addr of addresses) {
        if (isPrivateIP(addr.address)) {
          return {
            safe: false,
            reason: `Domain resolves to internal IP address. Scanning internal networks is not allowed.`,
            resolvedIp: addr.address,
          }
        }
      }
      // If we have at least one address, treat the first as the canonical resolved IP
      if (addresses.length > 0) {
        return { safe: true, resolvedIp: addresses[0].address }
      }
      // No addresses returned; treat as safe but without a resolved IP
      return { safe: true }
    } catch (dnsError) {
      // DNS resolution failed - let the actual fetch handle it
      return { safe: true }
    }
  } catch {
    return {
      safe: false,
      reason: "Invalid URL format.",
    }
  }
}

/**
 * Perform a fast, explicit check that the URL is an HTTP(S) URL pointing to a public host.
 * This is a simple syntactic guard that complements validateScanTarget's DNS/IP checks
 * and is easy for static analyzers to understand.
 */
function assertSafePublicHttpUrl(rawUrl: string): URL {
  let urlObj: URL
  try {
    urlObj = new URL(rawUrl)
  } catch {
    throw new Error("Invalid URL format")
  }

  const protocol = urlObj.protocol
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error("Invalid protocol - only http: and https: are allowed")
  }

  const hostname = urlObj.hostname.toLowerCase()

  // Disallow blocked hostnames (including exact and subdomain matches)
  if (isBlockedHostname(hostname)) {
    throw new Error("Access to local hostnames is not allowed")
  }

  // Disallow common internal TLD-like suffixes
  for (const suffix of DISALLOWED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      throw new Error("Access to internal hostnames is not allowed")
    }
  }

  // Optionally require at least one dot to avoid bare hostnames like "devbox"
  if (!hostname.includes(".")) {
    throw new Error("Access to unqualified hostnames is not allowed")
  }

  return urlObj
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
  const prevalidatedUrlObj = assertSafePublicHttpUrl(url)
  const normalizedUrl = prevalidatedUrlObj.href

  // If allowedHostnames is provided, enforce that the hostname matches
  if (allowedHostnames && allowedHostnames.length > 0) {
    const requestHostname = prevalidatedUrlObj.hostname.toLowerCase()
    const isAllowed = allowedHostnames.some(allowed => 
      allowed.toLowerCase() === requestHostname
    )
    if (!isAllowed) {
      throw new Error(`Hostname ${requestHostname} is not in the allowed list`)
    }
  }

  const safety = await validateScanTarget(normalizedUrl)
  
  if (!safety.safe) {
    throw new Error(safety.reason || "URL blocked for security reasons")
  }
  
  // We already parsed and normalized the URL in assertSafePublicHttpUrl above.
  const urlObj = prevalidatedUrlObj
  
  // If we have a validated resolved IP, construct a URL that uses it directly.
  // This prevents DNS from being consulted again at fetch time (avoiding DNS rebinding).
  let finalUrl = normalizedUrl
  let finalInit: RequestInit | undefined = init
  
  if (safety.resolvedIp) {
    const originalHostname = urlObj.hostname
    const originalPort = urlObj.port
    const hadExplicitPort = originalPort !== ""
    // Use URL constructor to safely build the URL with the resolved IP
    const urlWithIp = new URL(urlObj.href)
    const resolvedHostForUrl =
      isIP(safety.resolvedIp) === 6 ? `[${safety.resolvedIp}]` : safety.resolvedIp
    urlWithIp.hostname = resolvedHostForUrl
    // After changing hostname, ensure the port matches the original URL's explicit port (if any)
    if (hadExplicitPort) {
      urlWithIp.port = originalPort
    }
    finalUrl = urlWithIp.href
    
    // Ensure the original hostname is sent in the Host header for virtual hosting
    finalInit = setHostHeader(init, originalHostname)
  }
  
  // Use the normalized, DNS-safe href after validation and protocol check
  // lgtm[js/request-forgery] - URL is validated through validateScanTarget before fetch
  const controller = new AbortController()
  const timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
  const timeoutId = setTimeout(() => {
    controller.abort()
  }, timeoutMs)
  // Combine any caller-provided signal with our timeout signal so that either can abort the request.
  const { signal: combinedSignal, cleanup: cleanupCombinedSignal } = combineAbortSignals(
    controller.signal,
    finalInit?.signal,
  )
  const requestInit: RequestInit = {
    ...finalInit,
    signal: combinedSignal,
  }
  try {
    return await fetch(finalUrl, requestInit)
  } finally {
    clearTimeout(timeoutId)
    if (typeof cleanupCombinedSignal === "function") {
      cleanupCombinedSignal()
    }
  }
}
