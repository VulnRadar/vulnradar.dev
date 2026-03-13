/**
 * FTP Protocol Checks (FTP/FTPS)
 * 
 * These checks apply to FTP URLs.
 * FTP scanning is very limited since we can't easily scan FTP servers
 * without proper authentication and protocol handling.
 */

import type { Category, Vulnerability } from "../types"

// Categories applicable to FTP
export const FTP_CATEGORIES: Category[] = [
  "ssl", // FTPS only
  "configuration",
]

// FTP-specific check IDs
export const FTP_CHECK_IDS = [
  "ftp-insecure-connection",
  "ftps-certificate-validation",
  "ftp-anonymous-access",
  "ftp-banner-disclosure",
]

/**
 * FTP-specific vulnerability checks
 */
export function runFtpChecks(url: string): Vulnerability[] {
  const findings: Vulnerability[] = []
  const isSecure = url.startsWith("ftps://")
  
  // Check for insecure FTP
  if (!isSecure) {
    findings.push({
      id: `ftp-insecure-${Date.now()}`,
      title: "Insecure FTP Connection",
      description: "FTP transmits credentials and data in plaintext over the network.",
      severity: "critical",
      category: "ssl",
      evidence: `Protocol: ftp://`,
      riskImpact: "FTP credentials and all transferred files can be intercepted.",
      explanation: "FTP has no encryption. Any network observer can see passwords and file contents.",
      fixSteps: [
        "Use FTPS (FTP over TLS) instead of plain FTP",
        "Consider using SFTP (SSH File Transfer Protocol) for better security",
        "Implement VPN for FTP if encryption is not possible",
      ],
      codeExamples: [{
        label: "Secure Alternative - SFTP",
        language: "bash",
        code: `# Use SFTP instead of FTP
sftp user@example.com

# Or use FTPS
lftp -u user,password ftps://example.com`,
      }],
    })
  }
  
  // Add informational note about limited scanning
  findings.push({
    id: `ftp-limited-scan-${Date.now()}`,
    title: "Limited FTP Protocol Scan",
    description: "FTP protocol scanning is limited to connection-level security checks.",
    severity: "info",
    category: "configuration",
    evidence: `Protocol: ${url.split("://")[0]}://`,
    riskImpact: "Some security checks are not available for FTP endpoints.",
    explanation: "FTP servers cannot be scanned like HTTP. Full security assessment requires FTP client tools.",
    fixSteps: [
      "Use specialized FTP security scanners for comprehensive testing",
      "Review server configuration manually",
      "Check for anonymous access and directory permissions",
    ],
    codeExamples: [],
  })
  
  return findings
}

/**
 * Check if a check ID is applicable for FTP
 */
export function isFtpCheck(checkId: string): boolean {
  return FTP_CHECK_IDS.includes(checkId)
}

/**
 * Get applicable categories for FTP protocol
 */
export function getFtpCategories(isSecure: boolean): Category[] {
  if (isSecure) {
    return FTP_CATEGORIES
  }
  return FTP_CATEGORIES.filter(c => c !== "ssl")
}
