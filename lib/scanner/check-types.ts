/**
 * The canonical check interface.
 *
 * Every detection the engine grows from here declares itself as a single
 * `PageCheck` object: its metadata and its detection logic in one place, in
 * one file. Adding a detection is adding one entry.
 *
 * The engine speaks only this shape. The 638 pre-existing
 * `(url, headers, body) => string | null` detectors are wrapped into it by
 * `adaptLegacyCheck` in `registry.ts`, so there is one execution path, one
 * confidence model and one evidence model regardless of when a check was
 * written.
 */

import type { Category, Severity } from "./types";
import type { PageContext } from "./page-context";

/**
 * A verbatim excerpt from the response that proves a finding.
 *
 * A finding a user cannot verify is a finding they will not trust, so every
 * check that can point at a specific header value, script URL, cookie or line
 * of markup does so.
 */
export interface EvidenceExcerpt {
  /** What this excerpt is, e.g. "script src", "Set-Cookie", "CSP script-src". */
  label: string;
  /** The observed text, verbatim and truncated to a readable length. */
  value: string;
  /** 1-based line number in the response body, when it came from the body. */
  line?: number;
}

/** One instance of a detection firing. */
export interface CheckHit {
  /** Human-readable summary naming what was observed. */
  evidence: string;
  /** Verbatim proof from the response. */
  excerpts?: EvidenceExcerpt[];
  /** Overrides the check's declared confidence for this instance. */
  confidence?: number;
  /** Overrides the check's declared severity for this instance. */
  severity?: Severity;
}

/**
 * How a check reached its conclusion. Drives the default confidence and is
 * surfaced to the user so a header absence and a regex guess do not look
 * alike.
 */
export type DetectionMethod =
  | "header-absence"
  | "header-value"
  | "cookie-attribute"
  | "csp-analysis"
  | "dom-structure"
  | "script-analysis"
  | "url-pattern"
  | "body-pattern"
  | "network-probe"
  | "dns-record"
  | "tls-handshake";

/**
 * Default confidence per detection method.
 *
 * These are deliberately spread: a missing header is a fact about the
 * response, a regex over minified JavaScript is a guess. Reporting both at
 * 93% is what made the previous engine's confidence figure meaningless.
 */
export const METHOD_CONFIDENCE: Record<DetectionMethod, number> = {
  "header-absence": 98,
  "header-value": 96,
  "cookie-attribute": 97,
  "csp-analysis": 95,
  "dom-structure": 90,
  "script-analysis": 75,
  "url-pattern": 70,
  "body-pattern": 55,
  "network-probe": 95,
  "dns-record": 93,
  "tls-handshake": 96,
};

/** Context requirements, used to skip checks and to count what actually ran. */
export type CheckRequirement =
  "html" | "body" | "https" | "cookies" | "csp" | "scripts" | "forms";

export interface CodeExample {
  label: string;
  language: string;
  code: string;
}

/**
 * A check: metadata plus detection, declared together.
 *
 * `id` is a stable finding ID. It is diffed between runs and gated in CI, so
 * it must never change once shipped.
 */
export interface PageCheck {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  method: DetectionMethod;
  /** Overrides `METHOD_CONFIDENCE[method]` when a check is more or less sure. */
  confidence?: number;
  description: string;
  riskImpact: string;
  explanation: string;
  fixSteps: string[];
  codeExamples: CodeExample[];
  references?: string[];
  /**
   * Context this check needs. When a requirement is unmet the check is
   * skipped and counted as skipped rather than as run, so `checksRun` means
   * what it says.
   */
  needs?: CheckRequirement[];
  /**
   * Findings sharing a dedupe group describe the same underlying issue. Only
   * the highest-confidence one survives; the rest are folded into its
   * `alsoReportedBy` list.
   */
  dedupeGroup?: string;
  run(ctx: PageContext): CheckHit | CheckHit[] | null;
}

/** Truncate an evidence value to a length that stays readable in the UI. */
export function excerpt(
  label: string,
  value: string,
  line?: number,
): EvidenceExcerpt {
  const flat = value.replace(/\s+/g, " ").trim();
  return {
    label,
    value: flat.length > 300 ? flat.slice(0, 297) + "..." : flat,
    ...(line === undefined ? {} : { line }),
  };
}

/** 1-based line number of a byte offset in the response body. */
export function lineAt(body: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  const end = Math.min(offset, body.length);
  for (let i = 0; i < end; i++) if (body.charCodeAt(i) === 10) line++;
  return line;
}

/** Whether a check's requirements are satisfied by the parsed context. */
export function requirementsMet(check: PageCheck, ctx: PageContext): boolean {
  if (!check.needs || check.needs.length === 0) return true;
  for (const need of check.needs) {
    switch (need) {
      case "html":
        if (!ctx.isHtml || ctx.body.length === 0) return false;
        break;
      case "body":
        if (ctx.body.length === 0) return false;
        break;
      case "https":
        if (!ctx.isHttps) return false;
        break;
      case "cookies":
        if (ctx.cookies.length === 0) return false;
        break;
      case "csp":
        if (!ctx.csp) return false;
        break;
      case "scripts":
        if (ctx.scripts.length === 0) return false;
        break;
      case "forms":
        if (ctx.forms.length === 0) return false;
        break;
    }
  }
  return true;
}
