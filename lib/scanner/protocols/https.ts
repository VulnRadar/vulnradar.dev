/**
 * HTTPS/HTTP Protocol Checks
 * 
 * These checks apply to HTTP and HTTPS URLs.
 * They analyze headers, body content, cookies, and more.
 */

import type { Category } from "../types"

// Categories applicable to HTTPS/HTTP
export const HTTPS_CATEGORIES: Category[] = [
  "headers",
  "ssl", // HTTPS only
  "cookies",
  "content",
  "configuration",
  "information-disclosure",
]

// Check IDs that are HTTPS/HTTP specific
export const HTTPS_CHECK_IDS = [
  // Header checks
  "hsts-missing",
  "csp-missing",
  "clickjack-missing",
  "xcto-missing",
  "referrer-policy-missing",
  "permissions-policy-missing",
  "server-header-disclosure",
  "aspnet-version",
  "cors-wildcard",
  "cors-credentials-wildcard",
  "cache-control-sensitive",
  "cache-no-store-missing",
  "pragma-no-cache-missing",
  "coep-missing",
  "coop-missing",
  "corp-missing",
  "nel-missing",
  "report-to-missing",
  "x-dns-prefetch-control-missing",
  
  // SSL checks (HTTPS only)
  "ssl-certificate-expiry",
  "ssl-weak-cipher",
  "ssl-protocol-version",
  "mixed-content",
  
  // Cookie checks
  "cookie-httponly-missing",
  "cookie-secure-missing",
  "cookie-samesite-missing",
  "cookie-prefix-invalid",
  "session-cookie-flags",
  
  // Content checks
  "xss-sink-innerhtml",
  "xss-sink-document-write",
  "xss-sink-eval",
  "sri-missing",
  "unsafe-inline-script",
  "unsafe-inline-style",
  "form-action-missing",
  "base-uri-missing",
  "frame-ancestors-missing",
  "outdated-jquery",
  "outdated-angular",
  "sensitive-data-exposure",
  "api-key-exposure",
  "hardcoded-secrets",
  
  // Configuration checks
  "source-map-exposure",
  "debug-mode-enabled",
  "directory-listing",
  "error-disclosure",
  "stack-trace-exposure",
  
  // Information disclosure
  "internal-ip-exposure",
  "email-exposure",
  "phone-exposure",
  "credit-card-exposure",
  "ssn-exposure",
]

// Checks that should ONLY run on HTTPS (not HTTP)
export const HTTPS_ONLY_CHECK_IDS = [
  "hsts-missing",
  "ssl-certificate-expiry",
  "ssl-weak-cipher",
  "ssl-protocol-version",
  "cookie-secure-missing", // More critical for HTTPS
]

// Checks that ONLY apply to HTTP (insecure)
export const HTTP_ONLY_CHECK_IDS = [
  // No HTTP-only checks currently - most are warnings about being insecure
]

/**
 * Filter checks to only those applicable for HTTP/HTTPS
 */
export function filterHttpsChecks(checkIds: string[], isSecure: boolean): string[] {
  let filtered = checkIds.filter(id => HTTPS_CHECK_IDS.includes(id))
  
  if (!isSecure) {
    // Remove HTTPS-only checks for HTTP
    filtered = filtered.filter(id => !HTTPS_ONLY_CHECK_IDS.includes(id))
  }
  
  return filtered
}

/**
 * Check if a check ID is applicable for HTTP/HTTPS
 */
export function isHttpsCheck(checkId: string): boolean {
  return HTTPS_CHECK_IDS.includes(checkId)
}
