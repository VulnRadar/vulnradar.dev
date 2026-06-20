/**
 * Protocol-Specific Scanner Organization
 *
 * Each protocol has its own set of applicable checks and scanning behavior.
 * This module exports protocol configurations and the appropriate checks for each.
 */

import type { Vulnerability, Category } from "../types";

// Protocol types we support
export type SupportedProtocol =
  | "https"
  | "http"
  | "wss"
  | "ws"
  | "ftps"
  | "ftp";

// Protocol configuration
export interface ProtocolConfig {
  name: string;
  label: string;
  description: string;
  secure: boolean;
  categories: Category[];
  supportsBody: boolean;
  supportsHeaders: boolean;
  supportsCrawl: boolean;
}

// Protocol configurations
export const PROTOCOL_CONFIGS: Record<SupportedProtocol, ProtocolConfig> = {
  https: {
    name: "https",
    label: "HTTPS",
    description: "Secure HTTP - Full scan support",
    secure: true,
    categories: [
      "headers",
      "ssl",
      "cookies",
      "content",
      "configuration",
      "information-disclosure",
    ],
    supportsBody: true,
    supportsHeaders: true,
    supportsCrawl: true,
  },
  http: {
    name: "http",
    label: "HTTP",
    description: "Unencrypted HTTP - No SSL checks",
    secure: false,
    categories: [
      "headers",
      "cookies",
      "content",
      "configuration",
      "information-disclosure",
    ],
    supportsBody: true,
    supportsHeaders: true,
    supportsCrawl: true,
  },
  wss: {
    name: "wss",
    label: "WSS",
    description: "Secure WebSocket",
    secure: true,
    categories: ["ssl", "headers"],
    supportsBody: false,
    supportsHeaders: true,
    supportsCrawl: false,
  },
  ws: {
    name: "ws",
    label: "WS",
    description: "Unencrypted WebSocket",
    secure: false,
    categories: ["headers"],
    supportsBody: false,
    supportsHeaders: true,
    supportsCrawl: false,
  },
  ftps: {
    name: "ftps",
    label: "FTPS",
    description: "Secure FTP",
    secure: true,
    categories: ["ssl", "configuration"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  ftp: {
    name: "ftp",
    label: "FTP",
    description: "Unencrypted FTP",
    secure: false,
    categories: ["configuration"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
};

/**
 * Get protocol from URL
 */
export function getProtocolFromUrl(url: string): SupportedProtocol {
  try {
    const parsed = new URL(url);
    const proto = parsed.protocol.replace(":", "") as SupportedProtocol;
    if (proto in PROTOCOL_CONFIGS) return proto;
    return "https"; // default
  } catch {
    return "https";
  }
}

/**
 * Get configuration for a protocol
 */
export function getProtocolConfig(protocol: SupportedProtocol): ProtocolConfig {
  return PROTOCOL_CONFIGS[protocol];
}

/**
 * Check if a category is applicable for a protocol
 */
export function isCategoryApplicable(
  protocol: SupportedProtocol,
  category: Category,
): boolean {
  return PROTOCOL_CONFIGS[protocol].categories.includes(category);
}

/**
 * Get applicable categories for a protocol
 */
export function getApplicableCategories(
  protocol: SupportedProtocol,
): Category[] {
  return PROTOCOL_CONFIGS[protocol].categories;
}

/**
 * Check if protocol supports body scanning
 */
export function supportsBodyScan(protocol: SupportedProtocol): boolean {
  return PROTOCOL_CONFIGS[protocol].supportsBody;
}

/**
 * Check if protocol supports header scanning
 */
export function supportsHeaderScan(protocol: SupportedProtocol): boolean {
  return PROTOCOL_CONFIGS[protocol].supportsHeaders;
}

/**
 * Check if protocol supports crawling
 */
export function supportsCrawl(protocol: SupportedProtocol): boolean {
  return PROTOCOL_CONFIGS[protocol].supportsCrawl;
}

// ============================================================================
// R7: Client-facing SCAN_PROTOCOLS — display labels + applicable categories
// for the scanner form UI. Previously duplicated in components/scanner/scan-form.tsx
// with subtle drift (SCAN_PROTOCOLS added a "dns" category that PROTOCOL_CONFIGS
// did not). Kept here as the single source so adding a new protocol means
// editing one place.
// ============================================================================

export interface ScanProtocolOption {
  /** URL scheme prefix including the colon and slashes (e.g. "https://") */
  value: string;
  /** Short display label for the UI */
  label: string;
  /** One-line description shown in tooltips and dropdowns */
  description: string;
  /** Scanner categories applicable for this protocol */
  categories: Category[];
}

export const SCAN_PROTOCOLS: readonly ScanProtocolOption[] = [
  {
    value: "https://",
    label: "HTTPS",
    description: "Secure HTTP (recommended)",
    categories: [
      "headers",
      "ssl",
      "cookies",
      "content",
      "information-disclosure",
      "configuration",
      "dns",
    ],
  },
  {
    value: "http://",
    label: "HTTP",
    description: "Unencrypted HTTP",
    categories: [
      "headers",
      "cookies",
      "content",
      "information-disclosure",
      "configuration",
      "dns",
    ],
  },
  {
    value: "wss://",
    label: "WSS",
    description: "Secure WebSocket",
    categories: ["ssl", "headers"],
  },
  {
    value: "ws://",
    label: "WS",
    description: "WebSocket",
    categories: ["headers"],
  },
  {
    value: "ftp://",
    label: "FTP",
    description: "File Transfer Protocol",
    categories: ["configuration"],
  },
  {
    value: "ftps://",
    label: "FTPS",
    description: "Secure FTP",
    categories: ["ssl", "configuration"],
  },
];

export type ScanProtocol = (typeof SCAN_PROTOCOLS)[number]["value"];

export function isHttpProtocol(protocol: ScanProtocol): boolean {
  return protocol === "https://" || protocol === "http://";
}

/**
 * Generate protocol-specific findings for insecure protocols
 */
export function getProtocolFindings(url: string): Vulnerability[] {
  const protocol = getProtocolFromUrl(url);
  const findings: Vulnerability[] = [];

  // Insecure protocol warnings
  if (protocol === "http") {
    findings.push({
      id: `proto-http-insecure-${Date.now()}`,
      title: "Insecure HTTP Connection",
      description:
        "The site is served over HTTP instead of HTTPS, meaning all data is transmitted unencrypted.",
      severity: "high",
      category: "ssl",
      evidence: `Protocol: http://`,
      riskImpact:
        "Attackers can intercept all traffic including passwords, cookies, and sensitive data.",
      explanation:
        "HTTP transmits data in plaintext, allowing man-in-the-middle attacks.",
      fixSteps: [
        "Obtain an SSL/TLS certificate",
        "Redirect all HTTP traffic to HTTPS",
        "Enable HSTS",
      ],
      codeExamples: [],
    });
  }

  if (protocol === "ws") {
    findings.push({
      id: `proto-ws-insecure-${Date.now()}`,
      title: "Insecure WebSocket Connection",
      description:
        "WebSocket connection uses ws:// instead of wss://, data is transmitted unencrypted.",
      severity: "high",
      category: "ssl",
      evidence: `Protocol: ws://`,
      riskImpact:
        "WebSocket messages can be intercepted and modified by attackers.",
      explanation:
        "ws:// transmits data in plaintext. Use wss:// for secure WebSocket connections.",
      fixSteps: [
        "Use wss:// for secure WebSocket connections",
        "Obtain SSL certificate for the server",
      ],
      codeExamples: [],
    });
  }

  if (protocol === "ftp") {
    findings.push({
      id: `proto-ftp-insecure-${Date.now()}`,
      title: "Insecure FTP Connection",
      description: "FTP transmits credentials and data in plaintext.",
      severity: "critical",
      category: "ssl",
      evidence: `Protocol: ftp://`,
      riskImpact:
        "FTP credentials and files can be intercepted by anyone on the network.",
      explanation:
        "FTP has no encryption. FTPS or SFTP should be used instead.",
      fixSteps: [
        "Use FTPS (FTP over SSL/TLS) or SFTP (SSH File Transfer Protocol)",
      ],
      codeExamples: [],
    });
  }

  return findings;
}

// Re-export protocol-specific check modules
export * from "./https";
export * from "./websocket";
export * from "./ftp";
