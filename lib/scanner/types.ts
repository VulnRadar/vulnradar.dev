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
  | "secrets-extended"
  | "vibe-code"
  | "client-side"
  | "supply-chain"
  | "host-validation";

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
  "vibe-code",
  "client-side",
  "supply-chain",
  "host-validation",
];

/**
 * A verbatim excerpt from the scanned response that proves a finding.
 * Lets a user verify the finding without re-running the scan by hand.
 */
export interface EvidenceExcerpt {
  /** What this excerpt is, e.g. "script src", "Set-Cookie", "CSP script-src". */
  label: string;
  /** The observed text, verbatim. */
  value: string;
  /** 1-based line number in the response body, when it came from the body. */
  line?: number;
}

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
  /** 0–100: how certain we are this finding is a true positive */
  confidence?: number;
  /** How the finding was detected: e.g. "HTTP header presence check", "Response body pattern matching" */
  detectionMethod?: string;
  /** Verbatim proof pulled from the response, for the evidence panel. */
  evidenceExcerpts?: EvidenceExcerpt[];
  /**
   * Check IDs that detected the same underlying issue and were folded into
   * this finding by deduplication. Empty or absent when nothing was merged.
   */
  alsoReportedBy?: string[];
  /** AI post-scan verdict (populated asynchronously after the scan completes) */
  aiVerdict?: "confirmed" | "possible_fp" | "uncertain";
  /** 60–97: AI confidence in its own verdict */
  aiConfidence?: number;
  /** One-sentence AI rationale for the verdict */
  aiReason?: string;
  /**
   * File + line reference for a finding that came from source code rather
   * than a live HTTP response (e.g. a GitHub repo scan). Additive and
   * optional so every existing consumer (results list, severity badge,
   * export, share view) that only ever read URL-based findings keeps
   * working unchanged — they simply never see this field. `line` is
   * omitted when the detector that produced the finding doesn't track a
   * match position.
   */
  location?: {
    file: string;
    line?: number;
  };
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
  /**
   * 1–10 danger score. 1 = no issues found, 10 = critically exploitable.
   * Based on severity distribution and exploitability of findings.
   */
  dangerScore?: number;
  /**
   * 0–100: how confident the engine is in the accuracy of these results.
   * Reflects check type determinism and completeness of the scan.
   * Target is 95–100%.
   */
  engineConfidence?: number;
  /**
   * Branches of the async check layer ("dns" | "tls" | "live-fetch") that
   * did not finish within the scan's time budget. Absent or empty when
   * every branch completed. A category listed here means "not checked",
   * not "checked and clean": the UI should say so rather than treat a
   * missing finding from that area as a clean result.
   */
  incomplete?: string[];
  /** True when the scan ran against an authenticated session (see scan/authenticated/route.ts). */
  authenticated?: boolean;
}

export type ScanStatus = "idle" | "scanning" | "done" | "failed";

/**
 * Background scan job status, as tracked in `scan_history.status`. Distinct
 * from `ScanStatus` above, which is client-side UI state.
 */
export type ScanJobStatus = "pending" | "running" | "completed" | "failed";

export type ScanProgressPhase = "start" | "done";

/**
 * Reports genuine progress as the scan engine works through categories or
 * async branches. Called once per unit of work as it starts, and again when
 * it finishes; never estimated or faked. `category` is a `Category` value
 * for the synchronous engine (lib/scanner/engine.ts), or a branch label
 * ("dns" | "tls" | "live-fetch") for the async layer
 * (lib/scanner/async-checks.ts).
 */
export type ScanProgressHook = (
  category: string,
  phase: ScanProgressPhase,
) => void;
