import { SEVERITY_LEVELS } from "@/lib/config/constants";
import type { Vulnerability } from "@/lib/scanner/types";

// ════════════════════════════════════════════════════════════════════════════
// SMART SAFETY RATING ENGINE
//
// Philosophy: A site is "unsafe" only when there is EVIDENCE of actively
// exploitable vulnerabilities. Missing best-practice headers (CSP, HSTS, etc.)
// are hardening *recommendations*. They don't mean a site is dangerous to
// visit. Sites like Discord, Reddit, GitHub are safe even if they're missing
// a few headers.
//
// Three tiers of findings:
//   1. EXPLOITABLE  – Proves the site can be actively attacked right now
//   2. HARDENING     – Missing security headers or best practices (defensive)
//   3. INFORMATIONAL – Expected behavior, framework-specific, or trivial
// ════════════════════════════════════════════════════════════════════════════

export type SafetyRating = "safe" | "caution" | "unsafe";

interface Finding extends Pick<Vulnerability, "aiVerdict" | "aiConfidence"> {
  severity: string;
  title: string;
  confidence?: number;
}

// ── AI VERDICT WEIGHTING ───────────────────────────────────────────────────
//
// lib/ai/verify-findings.ts re-checks findings against live evidence and
// attaches aiVerdict/aiConfidence. Without this, a finding the AI already
// flagged as a likely false positive counts exactly the same as one it
// actively confirmed, which defeats the point of running verification.
//
//  - No verdict (AI never ran, or hasn't finished -- most scans won't have
//    100% AI coverage): weight 1, i.e. today's behavior, unchanged.
//  - "confirmed": corroborated against live evidence -- full weight, and a
//    touch above 1 since it's been actively backed up rather than merely
//    unexamined.
//  - "uncertain": the AI could neither confirm nor rule the finding out.
//    That's meaningfully different from "the AI thinks this is wrong", so
//    it gets a much smaller discount than possible_fp.
//  - "possible_fp": the AI actively suspects this is wrong. Scaled by its
//    own aiConfidence (60-97, see verify-findings.ts) because the model
//    itself expresses a gradient here -- a possible_fp called at 90+
//    confidence is a far stronger signal than one it was only 60% sure of.
// ════════════════════════════════════════════════════════════════════════════

const AI_CONFIDENCE_MIN = 60;
const AI_CONFIDENCE_MAX = 97;
const CONFIRMED_WEIGHT = 1.1;
const UNCERTAIN_WEIGHT = 0.75;
const POSSIBLE_FP_WEIGHT_AT_MIN_CONFIDENCE = 0.55;
const POSSIBLE_FP_WEIGHT_AT_MAX_CONFIDENCE = 0.1;

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

function aiWeight(f: Pick<Finding, "aiVerdict" | "aiConfidence">): number {
  switch (f.aiVerdict) {
    case "confirmed":
      return CONFIRMED_WEIGHT;
    case "uncertain":
      return UNCERTAIN_WEIGHT;
    case "possible_fp": {
      const confidence = clamp(
        f.aiConfidence ?? AI_CONFIDENCE_MIN,
        AI_CONFIDENCE_MIN,
        AI_CONFIDENCE_MAX,
      );
      const t =
        (confidence - AI_CONFIDENCE_MIN) /
        (AI_CONFIDENCE_MAX - AI_CONFIDENCE_MIN);
      return (
        POSSIBLE_FP_WEIGHT_AT_MIN_CONFIDENCE -
        t *
          (POSSIBLE_FP_WEIGHT_AT_MIN_CONFIDENCE -
            POSSIBLE_FP_WEIGHT_AT_MAX_CONFIDENCE)
      );
    }
    default:
      // No verdict at all: AI verification never ran on this finding, or
      // hasn't finished yet. Absence of a verdict must never be treated as
      // a signal of wrongness -- neutral, full weight.
      return 1;
  }
}

// ── TIER 1: Actively Exploitable Vulnerabilities ──────────────────────────
const exploitablePatterns = [
  "SQL Injection",
  "Command Injection",
  "XXE Vulnerability",
  "SSRF Vulnerability",
  "Path Traversal",
  "Insecure Deserialization",
  "DOM-Based XSS",
  "Prototype Pollution",
  "Hard-?coded (API Keys?|Secrets?)",
  "Authentication Tokens Exposed",
  "Credentials in URL",
  "JWT in URL",
  "Unencrypted HTTP",
  "Mixed Content",
  "CORS Allows Any Origin with Credentials",
  "Open Redirect",
];

// ── TIER 2: Hardening Recommendations ─────────────────────────────────────
const hardeningPatterns = [
  "Missing HSTS",
  "Missing Content Security Policy",
  "Missing X-Frame-Options",
  "Missing X-Content-Type-Options",
  "Missing Referrer Policy",
  "Missing Permissions Policy",
  "Clickjacking Protection",
  "Missing Cross-Origin",
  "Weak CSP",
  "Weak Crypto",
  "Cache-Control",
  "X-XSS-Protection",
  "DNS Prefetch",
  "Missing security.txt",
  "Report-Only",
  "CSP Contains",
  "Missing Subresource",
  "Insecure Form Submission",
  "Excessive Permissions",
  "Cookie",
  "Autocomplete",
];

// ── TIER 3: Always Informational ──────────────────────────────────────────
const alwaysInfoPatterns = [
  "Framework-Required",
  "Server Technology",
  "Server Header",
  "CMS Detected",
  "Robots.txt",
  "Source Maps",
  "HTML Comments",
  "Inline JavaScript",
  "Sensitive File",
  "Outdated JavaScript",
  "Directory Listing",
  "Security.txt",
  "OpenGraph",
  "Meta Refresh",
  "Base Tag",
  "Form Target",
  "Lazy Loading",
  "HTML Lang",
  "Viewport",
  "document.write",
  "Preconnect",
  "Input.*maxlength",
];

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => {
    try {
      return new RegExp(p, "i");
    } catch {
      return null as unknown as RegExp;
    }
  });
}

const exploitableRegexps = compilePatterns(exploitablePatterns);
const hardeningRegexps = compilePatterns(hardeningPatterns);
const alwaysInfoRegexps = compilePatterns(alwaysInfoPatterns);

const COMPILED = new Map<string[], RegExp[]>([
  [exploitablePatterns, exploitableRegexps],
  [hardeningPatterns, hardeningRegexps],
  [alwaysInfoPatterns, alwaysInfoRegexps],
]);

const matchesAny = (title: string, patterns: string[]): boolean => {
  const regexps = COMPILED.get(patterns);
  if (regexps) {
    return regexps.some((re, i) =>
      re
        ? re.test(title)
        : title.toLowerCase().includes(patterns[i].toLowerCase()),
    );
  }
  return patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(title);
    } catch {
      return title.toLowerCase().includes(p.toLowerCase());
    }
  });
};

export function getSafetyRating(findings: Finding[]): SafetyRating {
  const exploitable: Finding[] = [];
  const hardening: Finding[] = [];

  for (const f of findings) {
    if (f.severity === SEVERITY_LEVELS.INFO) continue;
    if (matchesAny(f.title, alwaysInfoPatterns)) continue;

    if (matchesAny(f.title, exploitablePatterns)) {
      exploitable.push(f);
    } else if (matchesAny(f.title, hardeningPatterns)) {
      hardening.push(f);
    } else {
      if (f.severity === SEVERITY_LEVELS.CRITICAL) {
        exploitable.push(f);
      } else if (f.severity === SEVERITY_LEVELS.HIGH) {
        hardening.push(f);
      }
    }
  }

  // Every threshold below is a weighted sum, not a raw count: each finding
  // contributes aiWeight(f) (1 when it has no AI verdict) instead of a flat
  // 1. With no AI coverage at all every weight is exactly 1, so every sum
  // equals the old count and every comparison below fires identically to
  // before -- this is a pure extension, not a behavior change, for the
  // common case of partial or missing AI verification.
  const weightedSum = (arr: Finding[], severity: string): number =>
    arr
      .filter((f) => f.severity === severity)
      .reduce((sum, f) => sum + aiWeight(f), 0);

  // ANY critical exploitable = UNSAFE. Weighted so a single critical finding
  // the AI has actively flagged as a likely false positive (a possible_fp
  // verdict at real confidence) can no longer alone dictate the scan's
  // headline verdict -- while several AI-discounted criticals can still add
  // up to the same signal as one full-weight one.
  const criticalExploitWeight = weightedSum(
    exploitable,
    SEVERITY_LEVELS.CRITICAL,
  );
  if (criticalExploitWeight >= 1) return "unsafe";

  // Multiple HIGH exploitable (2+, weighted) = UNSAFE
  const highExploitWeight = weightedSum(exploitable, SEVERITY_LEVELS.HIGH);
  if (highExploitWeight >= 2) return "unsafe";

  // A critical exploitable finding exists but AI verification discounted it
  // below the "unsafe on its own" bar. Don't let it disappear entirely --
  // fall back to CAUTION instead of dropping straight to safe.
  if (criticalExploitWeight > 0) return "caution";

  // Single HIGH exploitable (weighted) = CAUTION
  if (highExploitWeight >= 1) return "caution";

  // Medium exploitable (3+, weighted) = CAUTION
  const mediumExploitWeight = weightedSum(exploitable, SEVERITY_LEVELS.MEDIUM);
  if (mediumExploitWeight >= 3) return "caution";

  // Many high hardening issues (weighted) = CAUTION at most
  const highHardeningWeight =
    weightedSum(hardening, SEVERITY_LEVELS.HIGH) +
    weightedSum(hardening, SEVERITY_LEVELS.CRITICAL);
  if (highHardeningWeight >= 5) return "caution";

  return "safe";
}

// ════════════════════════════════════════════════════════════════════════════
// DANGER SCORE  (1–10)
//
// 1  = nothing found
// 2  = info/low findings only
// 3–4 = hardening gaps (missing best-practice headers)
// 5–6 = significant hardening gaps or one exploitable medium
// 7–8 = exploitable high-severity issues
// 9–10 = critical exploitable vulnerabilities
// ════════════════════════════════════════════════════════════════════════════

const SEVERITY_WEIGHTS: Record<string, number> = {
  critical: 4,
  high: 2,
  medium: 1,
  low: 0.3,
  info: 0.05,
};

export function getDangerScore(findings: Finding[]): number {
  if (findings.length === 0) return 1;

  // Anchor the score and its ceiling to the safety tier so a "Safe to Visit"
  // site can never show 10/10 risk just because it has many hardening gaps.
  const rating = getSafetyRating(findings);
  const tierBase: Record<SafetyRating, number> = {
    safe: 1,
    caution: 5,
    unsafe: 8,
  };
  const tierCap: Record<SafetyRating, number> = {
    safe: 4,
    caution: 7,
    unsafe: 10,
  };

  let score = tierBase[rating];

  for (const f of findings) {
    const sev = f.severity.toLowerCase();
    const baseWeight = SEVERITY_WEIGHTS[sev] ?? 0.1;

    const isExploitable = matchesAny(f.title, exploitablePatterns);
    const isHardening =
      !isExploitable && matchesAny(f.title, hardeningPatterns);

    // Exploitable: full weight. Hardening: 15%. Info/other: 5%.
    let multiplier: number;
    if (isExploitable) multiplier = 1.5;
    else if (isHardening) multiplier = 0.15;
    else multiplier = 0.05;

    // Scale by how much AI verification trusts this specific finding.
    // aiWeight is 1 when there's no verdict, so this is a no-op for the
    // common partial/no-AI-coverage case.
    score += baseWeight * multiplier * aiWeight(f);
  }

  return Math.min(tierCap[rating], Math.round(score));
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE CONFIDENCE  (0–100 %)
//
// Reflects how certain we are that the findings are accurate.
//
//  - Header-missing/present checks: 97% (binary presence).
//  - Header value / combined checks: 85-93%.
//  - Body-pattern checks: 60-70% (regex on HTML body; higher FP rate).
//  - DNS async checks: 90% (network is usually stable, record absence is definitive).
//  - TLS cert checks: 94% (cert data is authoritative).
//  - If async checks timed out some findings may be missing: -3%.
//
// When there are no findings, confidence is high (97%) — we are confident
// the site is clean based on all checks we ran.
// ════════════════════════════════════════════════════════════════════════════

export function getEngineConfidence(
  findings: Finding[],
  asyncTimedOut = false,
): number {
  const base = asyncTimedOut ? 94 : 97;

  if (findings.length === 0) return base;

  // Severity weights for averaging (more weight on serious findings)
  const sevWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0.5,
  };

  let totalWeight = 0;
  let weightedSum = 0;
  for (const f of findings) {
    const confidence = f.confidence ?? 85;
    const w = sevWeight[f.severity.toLowerCase()] ?? 1;
    weightedSum += confidence * w;
    totalWeight += w;
  }

  const avgConfidence = totalWeight > 0 ? weightedSum / totalWeight : base;

  // Overall confidence = blend of base scan completeness and finding accuracy
  const blended = base * 0.3 + avgConfidence * 0.7;

  return Math.round(Math.max(50, Math.min(100, blended)));
}
