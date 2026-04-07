/**
 * Safe Fetch Utility - SSRF Protection
 * 
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises"
import { isIP } from "net"

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

// IPv4 private ranges (RFC 1918 + special ranges)
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Private A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private B (172.16.0.0/12)
  /^192\.168\./,                     // Private C (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^2(2[4-9]|3[0-9])\./,             // Multicast (224.0.0.0/4 = 224-239.x.x.x)
  /^2(4[0-9]|5[0-5])\./,             // Reserved (240.0.0.0/4 = 240-255.x.x.x)
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

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "local",
  "internal",
  "intranet",
  "metadata",                    // Cloud metadata services
  "metadata.google.internal",    // GCP
  "169.254.169.254",            // AWS/GCP/Azure metadata
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
  const lower = hostname.toLowerCase()
  return BLOCKED_HOSTNAMES.some(blocked => 
    lower === blocked || lower.endsWith(`.${blocked}`)
  )
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
      if (addresses.length > 0 && addresses[0]?.address) {
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
 * Safe fetch wrapper that validates the target before making the request
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const safety = await validateScanTarget(url)
  
  if (!safety.safe) {
    throw new Error(safety.reason || "URL blocked for security reasons")
  }
  
  // Parse and normalize the URL after validation
  const urlObj = new URL(url)
  
  // Explicitly enforce allowed protocols (HTTP/HTTPS only)
  const protocol = urlObj.protocol
  if (!ALLOWED_PROTOCOLS.has(protocol)) {
    throw new Error("Invalid protocol - only http: and https: are allowed")
  }
  
  // If we have a validated resolved IP, construct a URL that uses it directly.
  // This prevents DNS from being consulted again at fetch time (avoiding DNS rebinding).
  let finalUrl = urlObj.href
  let finalInit: RequestInit | undefined = init
  
  if (safety.resolvedIp) {
    const originalHostname = urlObj.hostname
    // Use URL constructor to safely build the URL with the resolved IP
    const urlWithIp = new URL(urlObj.toString())
    urlWithIp.hostname = safety.resolvedIp
    // After changing hostname, ensure the port matches the original URL's port
    if (urlWithIp.port !== urlObj.port) {
      urlWithIp.port = urlObj.port
    }
    finalUrl = urlWithIp.href
    
    // Ensure the original hostname is sent in the Host header for virtual hosting
    finalInit = setHostHeader(init, originalHostname)
  }
  
  // Use the normalized, DNS-safe href after validation and protocol check
  // lgtm[js/request-forgery] - URL is validated through validateScanTarget before fetch
  return fetch(finalUrl, finalInit)
}
