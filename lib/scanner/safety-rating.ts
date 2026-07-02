import { SEVERITY_LEVELS } from "@/lib/config/constants";

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

interface Finding {
  severity: string;
  title: string;
  confidence?: number;
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
  "Hardcoded API Keys",
  "Authentication Tokens Exposed",
  "Credentials in URL",
  "JWT in URL",
  "Unencrypted HTTP",
  "Mixed Content",
  "CORS Allows Any Origin with Credentials",
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
  "Open Redirect",
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

  // ANY critical exploitable = UNSAFE
  if (exploitable.some((f) => f.severity === SEVERITY_LEVELS.CRITICAL))
    return "unsafe";

  // Multiple HIGH exploitable (2+) = UNSAFE
  const highExploits = exploitable.filter(
    (f) => f.severity === SEVERITY_LEVELS.HIGH,
  );
  if (highExploits.length >= 2) return "unsafe";

  // Single HIGH exploitable = CAUTION
  if (highExploits.length === 1) return "caution";

  // Medium exploitable (3+) = CAUTION
  const mediumExploits = exploitable.filter(
    (f) => f.severity === SEVERITY_LEVELS.MEDIUM,
  );
  if (mediumExploits.length >= 3) return "caution";

  // Many high hardening issues = CAUTION at most
  const highHardening = hardening.filter(
    (f) =>
      f.severity === SEVERITY_LEVELS.HIGH ||
      f.severity === SEVERITY_LEVELS.CRITICAL,
  );
  if (highHardening.length >= 5) return "caution";

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

  let score = 1;
  for (const f of findings) {
    const sev = f.severity.toLowerCase();
    const baseWeight = SEVERITY_WEIGHTS[sev] ?? 0.1;

    // Exploitable findings count more; hardening findings count less
    const isExploitable = matchesAny(f.title, exploitablePatterns);
    const isHardening =
      !isExploitable && matchesAny(f.title, hardeningPatterns);

    let multiplier = 1;
    if (isExploitable) multiplier = 1.5;
    else if (isHardening) multiplier = 0.6;
    else if (sev === SEVERITY_LEVELS.CRITICAL) multiplier = 1.4;
    else if (sev === SEVERITY_LEVELS.HIGH) multiplier = 1.1;

    score += baseWeight * multiplier;
  }

  return Math.min(10, Math.round(score));
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE CONFIDENCE  (0–100 %)
//
// Reflects how certain we are that the findings are accurate.
//
//  - Header-based checks are 100% deterministic.
//  - Body-pattern checks are 82% (regex may fire on benign content).
//  - DNS / TLS async checks are 95% (network is usually stable).
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
