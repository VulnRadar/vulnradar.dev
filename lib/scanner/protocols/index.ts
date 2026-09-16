/**
 * Protocol-Specific Scanner Organization
 *
 * Each protocol has its own set of applicable checks and scanning behavior.
 * This module exports protocol configurations and the appropriate checks for each.
 */

import type { Vulnerability, Category } from "../types";
import { generateId } from "../_helpers";

// Protocol types we support
export type SupportedProtocol =
  | "https"
  | "http"
  | "wss"
  | "ws"
  | "ftps"
  | "ftp"
  | "ssh"
  | "sftp"
  | "smtp"
  | "smtps"
  | "imap"
  | "imaps"
  | "pop3"
  | "pop3s"
  | "mongodb";

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
      "tls",
      "cookies",
      "content",
      "configuration",
      "information-disclosure",
      "dns",
      "email",
      "api",
      "code",
      "secrets-extended",
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
      "dns",
      "email",
      "api",
      "code",
      "secrets-extended",
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
    categories: ["ssl", "tls", "headers"],
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
  ssh: {
    name: "ssh",
    label: "SSH",
    description: "Secure Shell — port 22",
    secure: true,
    categories: ["configuration", "ssl"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  sftp: {
    name: "sftp",
    label: "SFTP",
    description: "SSH File Transfer Protocol — port 22",
    secure: true,
    categories: ["configuration", "ssl"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  smtp: {
    name: "smtp",
    label: "SMTP",
    description: "Mail submission — port 25 (or 587)",
    secure: false,
    categories: ["configuration", "email"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  smtps: {
    name: "smtps",
    label: "SMTPS",
    description: "SMTP over TLS — port 465",
    secure: true,
    categories: ["configuration", "email", "ssl"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  imap: {
    name: "imap",
    label: "IMAP",
    description: "Mail retrieval — port 143",
    secure: false,
    categories: ["configuration", "email"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  imaps: {
    name: "imaps",
    label: "IMAPS",
    description: "IMAP over TLS — port 993",
    secure: true,
    categories: ["configuration", "email", "ssl"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  pop3: {
    name: "pop3",
    label: "POP3",
    description: "Mail retrieval — port 110",
    secure: false,
    categories: ["configuration", "email"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  pop3s: {
    name: "pop3s",
    label: "POP3S",
    description: "POP3 over TLS — port 995",
    secure: true,
    categories: ["configuration", "email", "ssl"],
    supportsBody: false,
    supportsHeaders: false,
    supportsCrawl: false,
  },
  mongodb: {
    name: "mongodb",
    label: "MongoDB",
    description: "MongoDB wire protocol — port 27017",
    secure: false,
    categories: ["configuration", "secrets-extended"],
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

// R7: Client-facing SCAN_PROTOCOLS — display labels + applicable categories
// for the scanner form UI. Previously duplicated in components/scanner/scan-form.tsx
// with subtle drift (SCAN_PROTOCOLS added a "dns" category that PROTOCOL_CONFIGS
// did not). Kept here as the single source so adding a new protocol means
// editing one place.

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
      "tls",
      "cookies",
      "content",
      "information-disclosure",
      "configuration",
      "dns",
      "email",
      "api",
      "code",
      "secrets-extended",
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
      "api",
      "code",
      "secrets-extended",
    ],
  },
  {
    value: "wss://",
    label: "WSS",
    description: "Secure WebSocket",
    categories: ["ssl", "tls", "headers"],
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
    categories: ["ssl", "tls", "configuration"],
  },
  {
    value: "ssh://",
    label: "SSH",
    description: "Secure Shell (port 22)",
    categories: ["configuration", "ssl", "tls"],
  },
  {
    value: "smtp://",
    label: "SMTP",
    description: "Mail submission (port 25/587)",
    categories: ["configuration", "email"],
  },
  {
    value: "smtps://",
    label: "SMTPS",
    description: "SMTP over TLS (port 465)",
    categories: ["configuration", "email", "ssl", "tls"],
  },
  {
    value: "imap://",
    label: "IMAP",
    description: "Mail retrieval (port 143)",
    categories: ["configuration", "email"],
  },
  {
    value: "imaps://",
    label: "IMAPS",
    description: "IMAP over TLS (port 993)",
    categories: ["configuration", "email", "ssl", "tls"],
  },
  {
    value: "pop3://",
    label: "POP3",
    description: "Mail retrieval (port 110)",
    categories: ["configuration", "email"],
  },
  {
    value: "pop3s://",
    label: "POP3S",
    description: "POP3 over TLS (port 995)",
    categories: ["configuration", "email", "ssl", "tls"],
  },
  {
    value: "mongodb://",
    label: "MongoDB",
    description: "MongoDB wire protocol (port 27017)",
    categories: ["configuration", "secrets-extended"],
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
      id: generateId("proto-http-insecure", url),
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
      id: generateId("proto-ws-insecure", url),
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
      id: generateId("proto-ftp-insecure", url),
      title: "Insecure FTP Connection",
      description: "FTP transmits credentials and data in plaintext.",
      severity: "critical",
      category: "ssl",
      evidence: `Protocol: ftp://`,
      riskImpact:
        "FTP credentials and all transferred files can be intercepted.",
      explanation:
        "FTP has no encryption. FTPS or SFTP should be used instead.",
      fixSteps: [
        "Use FTPS (FTP over SSL/TLS) or SFTP (SSH File Transfer Protocol)",
      ],
      codeExamples: [],
    });
  }

  // ssh, smtp, imap, pop3 and mongodb produce nothing from the URL alone.
  // These used to report "SSH Service Detected ... reachable on port 22",
  // "MongoDB Service Detected" and "Plaintext SMTP/IMAP/POP3 Detected" (high)
  // before any connection was attempted, so an unreachable host got a service
  // finding and an SMTP server that advertises STARTTLS, the normal secure
  // setup, was told it sends credentials in the clear. What is true of the
  // service is known only after execute-scan.ts connects: see
  // sshServiceFinding and mongoServiceFinding below, and buildStartTlsFindings
  // in protocol-findings.ts, which reads the real capability banner.

  return findings;
}

/** An SSH service answered with a banner on this target. */
export function sshServiceFinding(url: string): Vulnerability {
  return {
    id: generateId("proto-ssh-detected", url),
    title: "SSH Service Reachable",
    description:
      "An SSH service answered with its version banner. The banner's version and the SSH-specific checks are reported separately.",
    severity: "info",
    category: "configuration",
    evidence: `Protocol: ssh://`,
    riskImpact:
      "SSH itself is secure, but weak configurations and old key-exchange algorithms can be exploited, and a reachable SSH port is a target for password guessing.",
    explanation:
      "SSH scanners check the protocol version string and the negotiated algorithms (e.g. SSH-1.5, 3DES, hmac-md5).",
    fixSteps: [
      "Disable SSH-1.",
      "Restrict to modern KEX (curve25519, diffie-hellman-group18) and ciphers (chacha20-poly1305, aes256-gcm).",
      "Disable password authentication in favor of public-key.",
    ],
    codeExamples: [],
  };
}

/** A MongoDB wire-protocol service answered on this target. */
export function mongoServiceFinding(url: string): Vulnerability {
  return {
    id: generateId("proto-mongodb-detected", url),
    title: "MongoDB Service Reachable",
    description:
      "A MongoDB wire-protocol service answered from this address. Whether it requires authentication is reported separately.",
    severity: "medium",
    category: "configuration",
    evidence: `Protocol: mongodb://`,
    riskImpact:
      "A database port reachable from the internet is one misconfiguration away from exposure. Exposed MongoDB without authentication has been the source of multiple mass-ransomware incidents.",
    explanation:
      "Database servers belong on a private network. Authentication protects the data, but a publicly reachable port still exposes the service to credential attacks and to any future authentication bypass.",
    fixSteps: [
      "Bind MongoDB to a private interface (bindIp: 127.0.0.1) or firewall it.",
      "Enable SCRAM authentication and require TLS.",
    ],
    codeExamples: [],
  };
}

// Re-export protocol-specific check modules
export * from "./websocket";
export * from "./ftp";
