/**
 * WebSocket Protocol Checks (WS/WSS)
 * 
 * These checks apply to WebSocket URLs.
 * WebSocket scanning is limited compared to HTTP since we can't easily
 * inspect the message payloads without establishing a connection.
 */

import type { Category, Vulnerability } from "../types"

// Categories applicable to WebSocket
export const WEBSOCKET_CATEGORIES: Category[] = [
  "ssl", // WSS only
  "headers",
]

// WebSocket-specific check IDs
export const WEBSOCKET_CHECK_IDS = [
  // Connection security
  "ws-insecure-connection",
  "wss-certificate-validation",
  
  // Headers (if HTTP upgrade response is available)
  "ws-cors-policy",
  "ws-origin-validation",
  "ws-sec-websocket-protocol",
  "ws-sec-websocket-accept",
  "ws-compression-enabled",
]

/**
 * WebSocket-specific vulnerability checks
 */
export function runWebSocketChecks(url: string, headers?: Headers): Vulnerability[] {
  const findings: Vulnerability[] = []
  const isSecure = url.startsWith("wss://")
  
  // Check for insecure WebSocket
  if (!isSecure) {
    findings.push({
      id: `ws-insecure-${Date.now()}`,
      title: "Insecure WebSocket Connection",
      description: "WebSocket connection uses ws:// instead of wss://",
      severity: "high",
      category: "ssl",
      evidence: `Protocol: ${url.split("://")[0]}://`,
      riskImpact: "All WebSocket messages transmitted in plaintext.",
      explanation: "Use wss:// for encrypted WebSocket connections.",
      fixSteps: [
        "Configure your server to support WSS (WebSocket Secure)",
        "Obtain and install an SSL/TLS certificate",
        "Update client code to connect via wss://",
      ],
      codeExamples: [{
        label: "Secure WebSocket Connection",
        language: "javascript",
        code: `const socket = new WebSocket('wss://example.com/socket');`,
      }],
    })
  }
  
  // Check headers if available (from HTTP upgrade)
  if (headers) {
    // Check for missing CORS restrictions
    const allowOrigin = headers.get("access-control-allow-origin")
    if (allowOrigin === "*") {
      findings.push({
        id: `ws-cors-wildcard-${Date.now()}`,
        title: "WebSocket CORS Wildcard",
        description: "WebSocket endpoint allows connections from any origin.",
        severity: "medium",
        category: "headers",
        evidence: `Access-Control-Allow-Origin: ${allowOrigin}`,
        riskImpact: "Any website can establish WebSocket connections to this endpoint.",
        explanation: "Consider restricting allowed origins for WebSocket connections.",
        fixSteps: [
          "Implement origin validation on the server",
          "Return specific allowed origins instead of wildcard",
        ],
        codeExamples: [],
      })
    }
    
    // Check WebSocket compression (potential CRIME attack vector)
    const extensions = headers.get("sec-websocket-extensions")
    if (extensions?.includes("permessage-deflate")) {
      findings.push({
        id: `ws-compression-${Date.now()}`,
        title: "WebSocket Compression Enabled",
        description: "WebSocket connection uses compression which may be vulnerable to CRIME-like attacks.",
        severity: "info",
        category: "configuration",
        evidence: `Sec-WebSocket-Extensions: ${extensions}`,
        riskImpact: "Compression combined with secrets in messages may leak data.",
        explanation: "Compression side-channel attacks like CRIME can reveal secrets.",
        fixSteps: [
          "Consider disabling compression for sensitive data",
          "Ensure secrets are not transmitted in compressed messages",
        ],
        codeExamples: [],
      })
    }
  }
  
  return findings
}

/**
 * Check if a check ID is applicable for WebSocket
 */
export function isWebSocketCheck(checkId: string): boolean {
  return WEBSOCKET_CHECK_IDS.includes(checkId)
}

/**
 * Get applicable categories for WebSocket protocol
 */
export function getWebSocketCategories(isSecure: boolean): Category[] {
  if (isSecure) {
    return WEBSOCKET_CATEGORIES
  }
  return WEBSOCKET_CATEGORIES.filter(c => c !== "ssl")
}
