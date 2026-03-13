/**
 * Safe Fetch Utility - SSRF Protection
 * 
 * Validates target URLs to prevent Server-Side Request Forgery (SSRF) attacks
 * by blocking requests to internal/private IP ranges and localhost.
 */

import { lookup } from "dns/promises"

// Private IP ranges (RFC 1918 + RFC 4193 + loopback + link-local)
const PRIVATE_IP_PATTERNS = [
  // IPv4 private ranges
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Private A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private B (172.16.0.0/12)
  /^192\.168\./,                     // Private C (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^224\./,                          // Multicast (224.0.0.0/4)
  /^240\./,                          // Reserved (240.0.0.0/4)
  /^255\./,                          // Broadcast
  
  // IPv6 private/special ranges
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
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip))
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
    
    // Check if hostname is an IP address
    if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
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
      return { safe: true, resolvedIp: addresses[0]?.address }
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
  
  return fetch(url, init)
}
