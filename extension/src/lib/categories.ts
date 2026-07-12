// The 12 scanner categories, with human-readable labels and the
// "what this checks" tooltip copy. Mirrors the labels in the docs
// knowledge file so the extension UI stays in sync with the main
// product.

import type { ScannerCategory, Severity } from "./types";

export interface CategoryMeta {
  readonly id: ScannerCategory;
  readonly label: string;
  readonly description: string;
  readonly defaultEnabled: boolean;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  {
    id: "headers",
    label: "Security Headers",
    description:
      "CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP, CORP, COEP, and every documented security header.",
    defaultEnabled: true,
  },
  {
    id: "ssl",
    label: "SSL Certificate",
    description:
      "Certificate chain, signature algorithm, issuer, expiry, SANs, OCSP stapling.",
    defaultEnabled: true,
  },
  {
    id: "tls",
    label: "TLS Configuration",
    description:
      "Protocol version (1.0/1.1/1.2/1.3), cipher suites, ALPN, OCSP stapling.",
    defaultEnabled: true,
  },
  {
    id: "content",
    label: "Content Analysis",
    description:
      "XSS sinks, reflected parameters, open redirects, mixed content, clickjacking, form autocomplete.",
    defaultEnabled: true,
  },
  {
    id: "cookies",
    label: "Cookie Security",
    description:
      "Secure flag, HttpOnly, SameSite, __Host-/__Secure- prefix compliance.",
    defaultEnabled: true,
  },
  {
    id: "configuration",
    label: "Server Configuration",
    description:
      "Server banner disclosure, framework fingerprints, exposed debug/admin endpoints, directory listing.",
    defaultEnabled: true,
  },
  {
    id: "information-disclosure",
    label: "Info Disclosure",
    description:
      "Source maps (.map files), .env exposure, .git directory exposure, stack traces in errors, debug endpoints.",
    defaultEnabled: true,
  },
  {
    id: "dns",
    label: "DNS Configuration",
    description:
      "SPF syntax, DMARC policy strength, DNSSEC, CAA records, dangling CNAMEs.",
    defaultEnabled: true,
  },
  {
    id: "email",
    label: "Email Security",
    description:
      "MX records, SMTP TLS, SPF/DKIM/DMARC alignment, spoofing surface area.",
    defaultEnabled: true,
  },
  {
    id: "api",
    label: "API Security",
    description:
      "CORS policy, rate-limit header presence, GraphQL introspection, OpenAPI exposure, Swagger UI, authentication methods.",
    defaultEnabled: true,
  },
  {
    id: "code",
    label: "Client-Side Code",
    description:
      "Inline JS patterns, CDN-fingerprinted vulnerable library versions, hardcoded secrets, eval usage, source maps.",
    defaultEnabled: true,
  },
  {
    id: "secrets-extended",
    label: "Exposed Secrets",
    description:
      "AWS keys, Stripe keys, GitHub tokens, OpenAI keys, Twilio, SendGrid, generic high-entropy strings.",
    defaultEnabled: true,
  },
] as const;

export const CATEGORIES_BY_ID: Readonly<Record<ScannerCategory, CategoryMeta>> =
  CATEGORIES.reduce(
    (acc, c) => {
      acc[c.id] = c;
      return acc;
    },
    {} as Record<ScannerCategory, CategoryMeta>,
  );

export interface ProbeMeta {
  readonly id: import("./types").ServiceProbeId;
  readonly label: string;
  readonly defaultPort: number;
  readonly description: string;
}

export const PROBES: readonly ProbeMeta[] = [
  {
    id: "ssh",
    label: "SSH",
    defaultPort: 22,
    description: "Banner grab + version disclosure on TCP/22.",
  },
  {
    id: "smtp",
    label: "SMTP",
    defaultPort: 587,
    description: "Banner grab + STARTTLS check on TCP/587 (or 25).",
  },
  {
    id: "imap",
    label: "IMAP",
    defaultPort: 143,
    description: "Banner grab on TCP/143 (or 993 for IMAPS).",
  },
  {
    id: "pop3",
    label: "POP3",
    defaultPort: 110,
    description: "Banner grab on TCP/110 (or 995 for POP3S).",
  },
  {
    id: "ftp",
    label: "FTP",
    defaultPort: 21,
    description: "Banner grab + cleartext check on TCP/21 (or 990 for FTPS).",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    defaultPort: 27017,
    description: "Banner + version disclosure check on TCP/27017.",
  },
] as const;

export const PROBES_BY_ID: Readonly<
  Record<import("./types").ServiceProbeId, ProbeMeta>
> = PROBES.reduce(
  (acc, p) => {
    acc[p.id] = p;
    return acc;
  },
  {} as Record<import("./types").ServiceProbeId, ProbeMeta>,
);

export function severityLabel(s: Severity): string {
  switch (s) {
    case "critical":
      return "Critical";
    case "high":
      return "High";
    case "medium":
      return "Medium";
    case "low":
      return "Low";
    case "info":
      return "Info";
  }
}
