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
        "FTP credentials and all transferred files can be intercepted.",
      explanation:
        "FTP has no encryption. FTPS or SFTP should be used instead.",
      fixSteps: [
        "Use FTPS (FTP over SSL/TLS) or SFTP (SSH File Transfer Protocol)",
      ],
      codeExamples: [],
    });
  }

  // Banner-style protocols — at scan time we open a TCP socket, read
  // the greeting, and look for version disclosure / unsupported flags.
  // The actual banner fetch lives in lib/scanner/async-checks.ts.
  if (protocol === "ssh") {
    findings.push({
      id: `proto-ssh-${Date.now()}`,
      title: "SSH Service Detected",
      description:
        "An SSH service is reachable on the standard port (22). Banner disclosure and key-exchange analysis run in async-checks.",
      severity: "info",
      category: "configuration",
      evidence: `Protocol: ssh://`,
      riskImpact:
        "SSH itself is secure, but weak configs and old key-exchange algorithms can be exploited.",
      explanation:
        "SSH scanners check the protocol version string and the negotiated algorithms (e.g. SSH-1.5, 3DES, hmac-md5).",
      fixSteps: [
        "Disable SSH-1.",
        "Restrict to modern KEX (curve25519, diffie-hellman-group18) and ciphers (chacha20-poly1305, aes256-gcm).",
        "Disable password authentication in favor of public-key.",
      ],
      codeExamples: [],
    });
  }

  if (protocol === "smtp" || protocol === "smtps") {
    const isSecure = protocol === "smtps";
    if (!isSecure) {
      findings.push({
        id: `proto-smtp-${Date.now()}`,
        title: "Plaintext SMTP Detected",
        description:
          "SMTP submission without STARTTLS exposes credentials in transit.",
        severity: "high",
        category: "configuration",
        evidence: `Protocol: smtp://`,
        riskImpact:
          "An on-path attacker can read authentication credentials and mail content.",
        explanation:
          "Plain SMTP transmits the AUTH command in the clear. Use submission (port 587) with STARTTLS, or SMTPS (port 465).",
        fixSteps: [
          "Force STARTTLS for submission (port 587).",
          "Publish MTA-STS and TLS-RPT DNS records.",
        ],
        codeExamples: [],
      });
    }
  }

  if (protocol === "imap" || protocol === "imaps") {
    const isSecure = protocol === "imaps";
    if (!isSecure) {
      findings.push({
        id: `proto-imap-${Date.now()}`,
        title: "Plaintext IMAP Detected",
        description:
          "IMAP without TLS exposes credentials and mailbox contents in transit.",
        severity: "high",
        category: "configuration",
        evidence: `Protocol: imap://`,
        riskImpact:
          "Credentials and all email sync traffic can be intercepted.",
        explanation: "Use IMAPS (port 993) or STARTTLS on port 143.",
        fixSteps: ["Disable IMAP on port 143 in favor of IMAPS (993)."],
        codeExamples: [],
      });
    }
  }

  if (protocol === "pop3" || protocol === "pop3s") {
    const isSecure = protocol === "pop3s";
    if (!isSecure) {
      findings.push({
        id: `proto-pop3-${Date.now()}`,
        title: "Plaintext POP3 Detected",
        description:
          "POP3 without TLS exposes credentials and downloaded mail in transit.",
        severity: "high",
        category: "configuration",
        evidence: `Protocol: pop3://`,
        riskImpact:
          "Credentials and downloaded email are visible on the network.",
        explanation: "Use POP3S (port 995) or STARTTLS on port 110.",
        fixSteps: ["Disable POP3 on port 110 in favor of POP3S (995)."],
        codeExamples: [],
      });
    }
  }

  if (protocol === "mongodb") {
    findings.push({
      id: `proto-mongodb-${Date.now()}`,
      title: "MongoDB Service Detected",
      description:
        "A MongoDB wire-protocol service is reachable on port 27017. Banner analysis runs in async-checks (isMaster / hello) for build info and auth requirements.",
      severity: "medium",
      category: "configuration",
      evidence: `Protocol: mongodb://`,
      riskImpact:
        "Exposed MongoDB without authentication has been the source of multiple mass-ransomware incidents.",
      explanation:
        "MongoDB exposes its version string in the hello/isMaster reply. Combined with no auth and a public bind, this is a high-risk exposure.",
      fixSteps: [
        "Bind MongoDB to a private interface (bindIp: 127.0.0.1) or firewall it.",
        "Enable SCRAM authentication and require TLS.",
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
