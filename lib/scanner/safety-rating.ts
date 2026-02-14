import { SEVERITY_LEVELS } from "@/lib/constants"

// ════════════════════════════════════════════════════════════════════════════
// SMART SAFETY RATING ENGINE
//
// Philosophy: A site is "unsafe" only when there is EVIDENCE of actively
// exploitable vulnerabilities. Missing best-practice headers (CSP, HSTS, etc.)
// are hardening *recommendations* -- they don't mean a site is dangerous to
// visit. Sites like Discord, Reddit, GitHub are safe even if they're missing
// a few headers.
//
// Three tiers of findings:
//   1. EXPLOITABLE  – Proves the site can be actively attacked right now
//   2. HARDENING     – Missing security headers or best practices (defensive)
//   3. INFORMATIONAL – Expected behavior, framework-specific, or trivial
// ════════════════════════════════════════════════════════════════════════════

export type SafetyRating = "safe" | "caution" | "unsafe"

interface Finding {
  severity: string
  title: string
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
]

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
]

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
]

const matchesAny = (title: string, patterns: string[]) =>
  patterns.some((p) => {
    try {
      return new RegExp(p, "i").test(title)
    } catch {
      return title.toLowerCase().includes(p.toLowerCase())
    }
  })

export function getSafetyRating(findings: Finding[]): SafetyRating {
  const exploitable: Finding[] = []
  const hardening: Finding[] = []

  for (const f of findings) {
    if (f.severity === SEVERITY_LEVELS.INFO) continue
    if (matchesAny(f.title, alwaysInfoPatterns)) continue

    if (matchesAny(f.title, exploitablePatterns)) {
      exploitable.push(f)
    } else if (matchesAny(f.title, hardeningPatterns)) {
      hardening.push(f)
    } else {
      if (f.severity === SEVERITY_LEVELS.CRITICAL) {
        exploitable.push(f)
      } else if (f.severity === SEVERITY_LEVELS.HIGH) {
        hardening.push(f)
      }
    }
  }

  // ANY critical exploitable = UNSAFE
  if (exploitable.some((f) => f.severity === SEVERITY_LEVELS.CRITICAL)) return "unsafe"

  // Multiple HIGH exploitable (2+) = UNSAFE
  const highExploits = exploitable.filter((f) => f.severity === SEVERITY_LEVELS.HIGH)
  if (highExploits.length >= 2) return "unsafe"

  // Single HIGH exploitable = CAUTION
  if (highExploits.length === 1) return "caution"

  // Medium exploitable (3+) = CAUTION
  const mediumExploits = exploitable.filter((f) => f.severity === SEVERITY_LEVELS.MEDIUM)
  if (mediumExploits.length >= 3) return "caution"

  // Many high hardening issues = CAUTION at most
  const highHardening = hardening.filter(
    (f) => f.severity === SEVERITY_LEVELS.HIGH || f.severity === SEVERITY_LEVELS.CRITICAL,
  )
  if (highHardening.length >= 5) return "caution"

  return "safe"
}
