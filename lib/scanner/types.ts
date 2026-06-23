/**
 * VulnRadar Detection Types
 *
 * Categories are intentionally fine-grained so that:
 *   - the scan orchestrator can filter checks per protocol (e.g. SMTP
 *     doesn't run content/body checks),
 *   - the docs page can group findings by concern rather than by
 *     protocol,
 *   - new check categories (email, tls, api, code, secrets-extended)
 *     slot in without breaking the existing surface.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "headers"
  | "ssl"
  | "tls"
  | "content"
  | "cookies"
  | "configuration"
  | "information-disclosure"
  | "dns"
  | "email"
  | "api"
  | "code"
  | "secrets-extended";

export const ALL_CATEGORIES: Category[] = [
  "headers",
  "ssl",
  "tls",
  "content",
  "cookies",
  "configuration",
  "information-disclosure",
  "dns",
  "email",
  "api",
  "code",
  "secrets-extended",
];

export interface Vulnerability {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  description: string;
  evidence: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
  codeExamples: {
    label: string;
    language: string;
    code: string;
  }[];
  references?: string[];
}

export interface ScanResult {
  url: string;
  scannedAt: string;
  duration: number;
  findings: Vulnerability[];
  checksRun?: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  responseHeaders?: Record<string, string>;
}

export type ScanStatus = "idle" | "scanning" | "done" | "failed";
