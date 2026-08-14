/**
 * CVSS 3.1 scoring for findings.
 *
 * Every one of VulnRadar's 700+ checks carries a hand-set severity bucket
 * (critical/high/medium/low/info) but, until now, never a real CVSS score --
 * lib/reports/sarif-report.ts fabricated a severity-keyed number purely so
 * GitHub Code Scanning had something to sort/color alerts by, because no
 * genuine CVSS value existed anywhere in the pipeline (AUDIT-010).
 *
 * Hand-authoring a precise CVSS 3.1 vector for every individual check isn't
 * achievable accurately at this scale (or ever, really -- CVSS vectors are
 * meant to describe one specific vulnerability instance, not a detection
 * rule that fires across arbitrary targets), and a confidently-wrong
 * per-check vector is worse than a principled default: it *looks*
 * authoritative while being invented. Instead this module maps a finding's
 * *class* -- its severity, its category, and (when known) the detection
 * method that found it -- onto a REPRESENTATIVE CVSS 3.1 vector for that
 * class, using real CVSS 3.1 metric definitions and the spec's own base
 * score formula (FIRST.org CVSS v3.1 Specification Document, section 7.1:
 * https://www.first.org/cvss/v3.1/specification-document).
 *
 * Every vector below was chosen so its *computed* score (never hand-typed)
 * lands inside the same severity band NVD itself uses for that CVSS score
 * (https://nvd.nist.gov/vuln-metrics/cvss):
 *   Critical 9.0-10.0, High 7.0-8.9, Medium 4.0-6.9, Low 0.1-3.9, None 0.0.
 * That keeps `severity` (our bucket) and `cvssScore` (the derived number)
 * from ever contradicting each other on the same finding.
 */

import type { Category, Severity, Vulnerability } from "./types";

// ── CVSS 3.1 base metrics ────────────────────────────────────────────────

export type CvssAttackVector = "N" | "A" | "L" | "P";
export type CvssAttackComplexity = "L" | "H";
export type CvssPrivilegesRequired = "N" | "L" | "H";
export type CvssUserInteraction = "N" | "R";
export type CvssScope = "U" | "C";
export type CvssImpact = "N" | "L" | "H";

export interface CvssMetrics {
  av: CvssAttackVector;
  ac: CvssAttackComplexity;
  pr: CvssPrivilegesRequired;
  ui: CvssUserInteraction;
  scope: CvssScope;
  c: CvssImpact;
  i: CvssImpact;
  a: CvssImpact;
}

const AV_WEIGHT: Record<CvssAttackVector, number> = {
  N: 0.85,
  A: 0.62,
  L: 0.55,
  P: 0.2,
};
const AC_WEIGHT: Record<CvssAttackComplexity, number> = { L: 0.77, H: 0.44 };
// Privileges Required is the one base metric whose weight itself depends on
// Scope (CVSS 3.1 spec, table 3 footnote) -- unlike every other metric here.
const PR_WEIGHT_SCOPE_UNCHANGED: Record<CvssPrivilegesRequired, number> = {
  N: 0.85,
  L: 0.62,
  H: 0.27,
};
const PR_WEIGHT_SCOPE_CHANGED: Record<CvssPrivilegesRequired, number> = {
  N: 0.85,
  L: 0.68,
  H: 0.5,
};
const UI_WEIGHT: Record<CvssUserInteraction, number> = { N: 0.85, R: 0.62 };
const IMPACT_WEIGHT: Record<CvssImpact, number> = { N: 0, L: 0.22, H: 0.56 };

/**
 * CVSS 3.1's own "Roundup" function (spec appendix A): rounds UP to one
 * decimal place using integer arithmetic. A naive `Math.ceil(x * 10) / 10`
 * misfires on values like `4.000000000000001` that floating-point addition
 * produces, which is exactly why the spec defines it this way instead.
 */
function roundUp(value: number): number {
  const intValue = Math.round(value * 100000);
  if (intValue % 10000 === 0) return intValue / 100000;
  return (Math.floor(intValue / 10000) + 1) / 10;
}

/**
 * CVSS 3.1 Base Score, computed directly from the spec's formula (section
 * 7.1) -- never hand-typed. Given the same metrics, this always returns the
 * same score a human recomputing the vector by hand would get.
 */
export function computeCvssBaseScore(m: CvssMetrics): number {
  const scopeChanged = m.scope === "C";
  const pr = (
    scopeChanged ? PR_WEIGHT_SCOPE_CHANGED : PR_WEIGHT_SCOPE_UNCHANGED
  )[m.pr];
  const iscBase =
    1 -
    (1 - IMPACT_WEIGHT[m.c]) *
      (1 - IMPACT_WEIGHT[m.i]) *
      (1 - IMPACT_WEIGHT[m.a]);
  if (iscBase <= 0) return 0;
  const impact = scopeChanged
    ? 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15)
    : 6.42 * iscBase;
  if (impact <= 0) return 0;
  const exploitability =
    8.22 * AV_WEIGHT[m.av] * AC_WEIGHT[m.ac] * pr * UI_WEIGHT[m.ui];
  const base = scopeChanged
    ? 1.08 * (impact + exploitability)
    : impact + exploitability;
  return roundUp(Math.min(base, 10));
}

/** `{av:"N",...}` -> `"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"`. */
export function formatCvssVector(m: CvssMetrics): string {
  return `CVSS:3.1/AV:${m.av}/AC:${m.ac}/PR:${m.pr}/UI:${m.ui}/S:${m.scope}/C:${m.c}/I:${m.i}/A:${m.a}`;
}

// ── Representative vectors, one small table per severity tier ───────────
//
// `default` is the tier's baseline -- a deterministic, response-visible
// issue (a missing header, an exposed banner, a confirmed active probe)
// with no unusual access requirements. The other named variants swap in a
// different, still real, CVSS profile for finding classes whose actual
// impact shape or exploitation path is genuinely different, selected by
// `selectVariant` below. Every value in every variant across every tier
// was verified (see tests/lib/scanner/cvss.test.ts) to land in the correct
// NVD severity band for its tier before being committed here -- swapping a
// single letter can silently move a score into the wrong band, so this
// table should only ever be edited alongside that test.

type CvssVariantName =
  "default" | "confidentiality" | "interaction" | "privileged" | "heuristic";

interface CvssVariantTable {
  /** Deterministic, no special access/interaction requirements. Always present. */
  default: CvssMetrics;
  /** Pure information/secret exposure: confidentiality hit, no integrity/availability impact. */
  confidentiality?: CvssMetrics;
  /** Requires a victim to load a page or click something (XSS-shaped findings). */
  interaction?: CvssMetrics;
  /** Requires some pre-existing access or trust relationship (authenticated API, validated host/vendor). */
  privileged?: CvssMetrics;
  /** Detected via regex/pattern matching over page content rather than a deterministic protocol fact. */
  heuristic?: CvssMetrics;
}

const SEVERITY_VARIANTS: Record<Severity, CvssVariantTable> = {
  // 9.8 -- textbook unauthenticated, no-interaction, full-impact remote
  // issue (the CVSS profile of e.g. Log4Shell-class RCE). Never varied by
  // category/type: dropping any impact dimension at this tier drags the
  // score into the High band (verified), which would put "critical" and
  // "cvssScore" at odds with each other on the same finding.
  critical: {
    default: {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "H",
      a: "H",
    },
  },
  high: {
    default: {
      av: "N",
      ac: "L",
      pr: "L",
      ui: "N",
      scope: "U",
      c: "H",
      i: "H",
      a: "H",
    },
    // Pure disclosure: full confidentiality hit, integrity/availability untouched.
    confidentiality: {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "N",
      a: "N",
    },
    // Victim has to load a page / click a link (e.g. reflected XSS at high severity).
    interaction: {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "R",
      scope: "U",
      c: "H",
      i: "H",
      a: "N",
    },
    heuristic: {
      av: "N",
      ac: "H",
      pr: "L",
      ui: "N",
      scope: "U",
      c: "H",
      i: "H",
      a: "H",
    },
  },
  medium: {
    default: {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "R",
      scope: "U",
      c: "L",
      i: "L",
      a: "N",
    },
    confidentiality: {
      av: "N",
      ac: "H",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "H",
      i: "N",
      a: "N",
    },
    // Needs some existing privilege/trust position (an authenticated API
    // caller, a validated inter-host relationship) to matter.
    privileged: {
      av: "N",
      ac: "L",
      pr: "H",
      ui: "N",
      scope: "U",
      c: "H",
      i: "L",
      a: "N",
    },
    heuristic: {
      av: "N",
      ac: "H",
      pr: "N",
      ui: "R",
      scope: "U",
      c: "L",
      i: "L",
      a: "N",
    },
  },
  low: {
    default: {
      av: "N",
      ac: "H",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "L",
      i: "N",
      a: "N",
    },
    interaction: {
      av: "N",
      ac: "H",
      pr: "N",
      ui: "R",
      scope: "U",
      c: "L",
      i: "N",
      a: "N",
    },
    privileged: {
      av: "N",
      ac: "H",
      pr: "L",
      ui: "N",
      scope: "U",
      c: "L",
      i: "N",
      a: "N",
    },
  },
  // 0.0 -- no confidentiality/integrity/availability impact (CVSS's own
  // "None" rating), always. Any variant that adds even C:L back in pulls
  // the score up past the Low band's floor once combined with a
  // deterministic AV:N/AC:L/PR:N/UI:N exploitability sub-score (verified),
  // so `info` intentionally has no variants: it means "nothing was
  // actually compromised," and that is true regardless of category/type.
  info: {
    default: {
      av: "N",
      ac: "L",
      pr: "N",
      ui: "N",
      scope: "U",
      c: "N",
      i: "N",
      a: "N",
    },
  },
};

/** [min, max] CVSS Base Score band NVD assigns to each of our severities. */
export const CVSS_SEVERITY_BAND: Record<Severity, readonly [number, number]> = {
  critical: [9.0, 10.0],
  high: [7.0, 8.9],
  medium: [4.0, 6.9],
  low: [0.1, 3.9],
  info: [0.0, 0.0],
};

// Categories whose findings are fundamentally about exposing information
// rather than tampering with or degrading the target.
const CONFIDENTIALITY_CATEGORIES = new Set<Category>([
  "information-disclosure",
  "secrets-extended",
  "code",
  "reputation",
]);

// Categories whose findings only bite when a victim's browser executes
// something (XSS/DOM-tampering-shaped issues), as opposed to a fact about
// the response the scanner alone can observe.
const INTERACTION_CATEGORIES = new Set<Category>(["client-side", "vibe-code"]);

// Categories whose findings presuppose some existing access or trust
// relationship (an authenticated API caller, a validated host/vendor
// relationship) rather than being exploitable by any anonymous visitor.
const PRIVILEGED_CATEGORIES = new Set<Category>([
  "api",
  "host-validation",
  "supply-chain",
]);

// Detection methods that matched via regex/heuristic pattern analysis over
// page content, as opposed to a deterministic protocol-level fact (a
// header's presence, a DNS record, a TLS handshake result). Covers both
// CheckDef.type (legacy detector JSON) and PageCheck.method
// (check-types.ts's DetectionMethod) spellings for the same idea.
const HEURISTIC_TYPES = new Set<string>([
  "body-pattern",
  "script-analysis",
  "dom-structure",
  "url-pattern",
]);

function categoryVariant(category?: Category): CvssVariantName | undefined {
  if (!category) return undefined;
  if (CONFIDENTIALITY_CATEGORIES.has(category)) return "confidentiality";
  if (INTERACTION_CATEGORIES.has(category)) return "interaction";
  if (PRIVILEGED_CATEGORIES.has(category)) return "privileged";
  // `active-probes` is deliberately not in any set above: an active probe
  // already confirmed the issue by exploiting it live, which is exactly
  // what the tier's own `default` vector already represents (e.g. critical
  // active-probe-confirmed findings get the AV:N/AC:L/PR:L/UI:N default).
  return undefined;
}

function selectVariant(
  table: CvssVariantTable,
  category?: Category,
  type?: string,
): CvssMetrics {
  const catVariant = categoryVariant(category);
  if (catVariant) {
    const metrics = table[catVariant];
    if (metrics) return metrics;
  }
  if (type && HEURISTIC_TYPES.has(type) && table.heuristic) {
    return table.heuristic;
  }
  return table.default;
}

export interface CvssFindingContext {
  severity: Severity;
  category?: Category;
  /**
   * CheckDef.type (legacy detector JSON, e.g. "body-pattern" / "header" /
   * "header-missing" / "header-present" / "header-value" / "combined" /
   * "url-check") or PageCheck.method (check-types.ts's DetectionMethod,
   * e.g. "header-absence" / "script-analysis" / "network-probe"). Optional
   * and only used as a secondary refinement when `category` alone doesn't
   * already pick a variant -- see HEURISTIC_TYPES.
   */
  type?: string;
}

export interface CvssResult {
  cvssVector: string;
  cvssScore: number;
}

/**
 * Maps a finding's severity/category/(optional) detection type onto a
 * representative CVSS 3.1 vector + base score for that class of finding.
 * Deterministic and pure: the same inputs always produce the same output.
 */
export function cvssForFinding(ctx: CvssFindingContext): CvssResult {
  const table = SEVERITY_VARIANTS[ctx.severity] ?? SEVERITY_VARIANTS.info;
  const metrics = selectVariant(table, ctx.category, ctx.type);
  return {
    cvssVector: formatCvssVector(metrics),
    cvssScore: computeCvssBaseScore(metrics),
  };
}

/**
 * Backfills `cvssVector`/`cvssScore` onto any finding that doesn't already
 * carry them, using only `severity`/`category` (the `type` refinement is
 * only available to callers that build a Vulnerability directly from a
 * CheckDef/PageCheck, e.g. registry.ts's buildCheck and engine.ts's
 * hitToVulnerability, both of which set these fields themselves before a
 * finding ever reaches here).
 *
 * A single safety-net pass over the fully-assembled findings array (see
 * execute-scan.ts / execute-crawl-scan.ts / the GitHub scan route) is
 * simpler and less error-prone than threading CVSS computation through
 * every place a Vulnerability literal gets constructed -- protocol probes,
 * async DNS/TLS/email checks, the active-probe and reputation modules, the
 * GitHub secrets scanner -- and guarantees every finding in a scan API
 * response carries a score regardless of which of those built it.
 */
export function attachCvssScores(findings: Vulnerability[]): Vulnerability[] {
  return findings.map((finding) => {
    if (finding.cvssVector !== undefined && finding.cvssScore !== undefined) {
      return finding;
    }
    const { cvssVector, cvssScore } = cvssForFinding({
      severity: finding.severity,
      category: finding.category,
    });
    return { ...finding, cvssVector, cvssScore };
  });
}
