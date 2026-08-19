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

import type { DnsRecords } from "./dns-records";
import type { DiscoveryResult } from "./subdomain-types";
import type { FindingRemediation } from "./remediation";

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
  | "host-validation"
  | "reputation"
  | "active-probes";

/**
 * Every category EXCEPT `active-probes`, which is the only category that
 * actively submits data to the target (a canary value into discovered
 * forms) instead of only reading responses. `active-probes` is
 * deliberately excluded from this list -- see
 * lib/scanner/async-checks.ts's buildBranches, where an omitted/empty
 * `scanners` filter means "run everything", and `active-probes` running by
 * default would silently start writing to a site the moment someone
 * scanned it with no explicit opt-in. Add a category here when it should
 * run by default; add it to the `Category` union above either way.
 */
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
  "reputation",
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
  /**
   * CWE (Common Weakness Enumeration) ID this finding maps to, e.g.
   * "CWE-79". Optional: only set where the mapping is unambiguous. Powers
   * SARIF export's rule tags and future compliance-mapping views. Left
   * unset rather than guessed when a check is too specific/aggregate for
   * a single CWE to fit well.
   */
  cwe?: string;
  /**
   * OWASP Top 10 (2021) category this finding maps to, e.g. "A03:2021".
   * Same optionality rules as `cwe`.
   */
  owasp?: string;
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
  /**
   * Exploit-likelihood enrichment (lib/scanner/cve-enrichment.ts), populated
   * as a post-processing pass over completed scan findings — not by any
   * individual check. CVE IDs are parsed out of the finding's own text
   * (title/description/evidence/riskImpact), so this works for any check
   * that happens to name a CVE, without that check needing to tag one
   * explicitly. Absent when the finding names no CVE, or when both external
   * lookups (CISA KEV, FIRST.org EPSS) were unavailable.
   */
  /** CVE identifiers found in this finding's own text, e.g. ["CVE-2021-44228"]. */
  cveIds?: string[];
  /**
   * FIRST.org EPSS score (0-1): modeled probability a CVE will be exploited
   * in the wild in the next 30 days. The highest score across cveIds when
   * a finding names more than one.
   */
  epssScore?: number;
  /**
   * True when at least one of cveIds appears in CISA's Known Exploited
   * Vulnerabilities catalog, i.e. CISA has confirmed active, in-the-wild
   * exploitation. Absent (not false) when the KEV catalog itself couldn't
   * be fetched, so "not in KEV" and "couldn't check" stay distinguishable.
   */
  inKev?: boolean;
  /**
   * CVSS 3.1 vector string, e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H".
   * A representative vector for this finding's severity/category/detection
   * class (lib/scanner/cvss.ts), not a hand-authored per-instance CVSS
   * assessment -- see that file's header comment for why. Backfilled onto
   * every finding by attachCvssScores() as a safety net, so this is present
   * on every finding in a completed scan's response even if the check that
   * produced it didn't set one explicitly.
   */
  cvssVector?: string;
  /** CVSS 3.1 base score (0.0-10.0) computed from cvssVector via the spec's own Roundup formula. */
  cvssScore?: number;
  /**
   * The OWNER's remediation tracking for this finding (Open / In progress /
   * Fixed / Accepted risk / Won't fix, plus an optional note and free-text
   * assignee). Distinct from `aiVerdict` and from the accuracy feedback:
   * this is the user's own "what have I done about it" status, keyed on the
   * stable finding_id so it persists across rescans of the same target (see
   * lib/scanner/remediation.ts). Attached server-side only on an owner's own
   * result-load (history/[id], scan/status/[id]); never populated on the
   * public /shared or /host views, so it never leaks. Absent when the owner
   * has set no status (the implicit "open" default).
   */
  remediation?: FindingRemediation;
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
   * SSL Labs-style TLS letter grade for the scanned host: "A+", "A", "B",
   * "C", "D", or "F". Computed by lib/scanner/ssl-grade.ts from the TLS
   * handshake (protocol, key strength, cipher, certificate trust) and stored
   * in result_meta.sslGrade. Absent when the target was HTTP-only or the TLS
   * endpoint was never reached, so a missing grade never means "F".
   */
  sslGrade?: string;
  /**
   * Full structured DNS record set (A, AAAA, CNAME, MX, NS, TXT, CAA, SOA)
   * for the scanned host, resolved during the DNS branch by
   * lib/scanner/dns-records.ts and stored in result_meta.dnsRecords. This is
   * structured data for the "full DNS" panel, not findings. Absent when the
   * target had no resolvable records (raw IP, unreachable) -- consumers render
   * nothing rather than an empty panel. Designed so a later scheduled-refresh
   * pass can update this shape in place.
   */
  dnsRecords?: DnsRecords;
  /**
   * Auto-discovered subdomains for the scanned host: the same shape the
   * manual "Discover subdomains" flow produces, captured automatically during
   * the scan by lib/scanner/subdomain-auto.ts and stored in
   * result_meta.subdomains. Reuses the manual flow's per-domain cache, so it
   * is populated instantly on a repeat scan and best-effort on the first.
   * Absent when discovery found nothing, timed out, or the target was a raw
   * IP -- consumers render the manual "Discover" button rather than an empty
   * panel.
   */
  subdomains?: DiscoveryResult;
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
  /**
   * Short (3-5 sentence) plain-English narrative of this scan's overall
   * results, generated on demand by lib/ai/scan-summary.ts and persisted
   * into scan_history.result_meta (see app/api/v3/history/[id]/summary/route.ts).
   * Absent until a user requests it; unlike per-finding aiVerdict this is
   * never generated automatically as part of the scan itself.
   */
  aiSummary?: string;
  /**
   * Reference to an opt-in above-the-fold screenshot of the scanned page,
   * captured through BrowserBase (lib/scanner/page-screenshot.ts) and stored
   * as bytes in the scan_screenshots table -- NOT the image itself, so
   * result_meta stays small. Only its metadata rides here; the bytes are
   * fetched separately from GET /api/v3/scan/screenshot/[id] (owner/public)
   * or GET /api/v3/shared/[token]/screenshot (shared link). Absent when the
   * user did not opt in, when BrowserBase is not configured, or when the
   * capture failed or the live-browser minute allowance was exhausted --
   * consumers render nothing rather than a broken image.
   */
  screenshot?: {
    width: number;
    height: number;
    capturedAt: string;
  };
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
