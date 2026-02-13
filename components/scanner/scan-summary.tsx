import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react"
import type { ScanResult } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"
import { SEVERITY_LEVELS } from "@/lib/constants"

interface ScanSummaryProps {
  result: ScanResult
}

type SafetyRating = "safe" | "caution" | "unsafe"

function getSafetyRating(summary: ScanResult["summary"], findings: ScanResult["findings"]): SafetyRating {
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

  // ── TIER 1: Actively Exploitable Vulnerabilities ──────────────────────────
  // These indicate REAL danger to visitors. Finding even one = serious concern.
  const exploitablePatterns = [
    // Injection attacks (confirmed patterns in source)
    "SQL Injection",
    "Command Injection",
    "XXE Vulnerability",
    "SSRF Vulnerability",
    "Path Traversal",
    "Insecure Deserialization",
    // XSS / Code execution
    "DOM-Based XSS",
    "Prototype Pollution",
    // Credential / token exposure
    "Hardcoded API Keys",
    "Authentication Tokens Exposed",
    "Credentials in URL",
    "JWT in URL",
    // Active data interception
    "Unencrypted HTTP",          // Entire site on HTTP = actively interceptable
    "Mixed Content",             // HTTPS site loading HTTP resources
    // Dangerous CORS that allows credential theft
    "CORS Allows Any Origin with Credentials",
  ]

  // ── TIER 2: Hardening Recommendations ─────────────────────────────────────
  // Missing best practices. Important to fix, but don't mean the site is
  // dangerous to *visit*. These are defensive layers, not active threats.
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
    "Open Redirect",               // Potential, not confirmed exploit
    "Insecure Form Submission",    // Missing HTTPS on form action
    "Excessive Permissions",
    "Cookie",                      // Cookie flag issues are hardening
    "Autocomplete",
  ]

  // ── TIER 3: Always Informational (never count toward unsafe/caution) ──────
  const alwaysInfoPatterns = [
    "Framework-Required",
    "Server Technology",
    "Server Header",
    "CMS Detected",
    "Robots.txt",
    "Source Maps",
    "HTML Comments",
    "Inline JavaScript",           // Common and often benign
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

  // ── Classify each finding ─────────────────────────────────────────────────
  const matchesAny = (title: string, patterns: string[]) =>
    patterns.some((p) => {
      try { return new RegExp(p, "i").test(title) } catch { return title.toLowerCase().includes(p.toLowerCase()) }
    })

  const exploitable: typeof findings = []
  const hardening: typeof findings = []

  for (const f of findings) {
    // Skip info severity entirely -- never counts
    if (f.severity === SEVERITY_LEVELS.INFO) continue

    // Skip anything that matches the always-informational patterns
    if (matchesAny(f.title, alwaysInfoPatterns)) continue

    // Classify: is this an actual exploit or a hardening recommendation?
    if (matchesAny(f.title, exploitablePatterns)) {
      exploitable.push(f)
    } else if (matchesAny(f.title, hardeningPatterns)) {
      hardening.push(f)
    } else {
      // Unknown finding -- classify by severity
      if (f.severity === SEVERITY_LEVELS.CRITICAL) {
        exploitable.push(f)
      } else if (f.severity === SEVERITY_LEVELS.HIGH) {
        // HIGH severity unknowns could be either -- treat as hardening
        // unless evidence looks like an active vulnerability
        hardening.push(f)
      }
      // MEDIUM/LOW unknowns are just hardening
    }
  }

  // ── Determine Safety Rating ───────────────────────────────────────────────

  // ANY critical exploitable vulnerability = UNSAFE (this is a real threat)
  const criticalExploits = exploitable.filter(
    (f) => f.severity === SEVERITY_LEVELS.CRITICAL
  )
  if (criticalExploits.length > 0) return "unsafe"

  // Multiple HIGH exploitable vulnerabilities (2+) = UNSAFE
  const highExploits = exploitable.filter(
    (f) => f.severity === SEVERITY_LEVELS.HIGH
  )
  if (highExploits.length >= 2) return "unsafe"

  // Single HIGH exploitable vulnerability = CAUTION (could be false positive)
  if (highExploits.length === 1) return "caution"

  // Medium exploitable findings (3+) = CAUTION
  const mediumExploits = exploitable.filter(
    (f) => f.severity === SEVERITY_LEVELS.MEDIUM
  )
  if (mediumExploits.length >= 3) return "caution"

  // Hardening issues alone NEVER make a site "unsafe".
  // Many hardening issues = CAUTION at most (recommendations, not threats).
  const highHardening = hardening.filter(
    (f) => f.severity === SEVERITY_LEVELS.HIGH || f.severity === SEVERITY_LEVELS.CRITICAL
  )
  if (highHardening.length >= 5) return "caution"

  // Everything else = SAFE
  // A site with only missing headers, low/info findings, or a few medium
  // hardening items is still safe to visit.
  return "safe"
}

const severityCards = [
  {
    key: SEVERITY_LEVELS.CRITICAL,
    label: "Critical",
    icon: ShieldX,
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    accent: "bg-red-500",
  },
  {
    key: SEVERITY_LEVELS.HIGH,
    label: "High",
    icon: ShieldAlert,
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    accent: "bg-orange-500",
  },
  {
    key: SEVERITY_LEVELS.MEDIUM,
    label: "Medium",
    icon: TriangleAlert,
    color: "text-yellow-600 dark:text-yellow-400",
    bg: "bg-yellow-500/10",
    border: "border-yellow-500/20",
    accent: "bg-yellow-500",
  },
  {
    key: SEVERITY_LEVELS.LOW,
    label: "Low",
    icon: AlertTriangle,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    accent: "bg-blue-500",
  },
  {
    key: SEVERITY_LEVELS.INFO,
    label: "Info",
    icon: Info,
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    border: "border-border",
    accent: "bg-muted-foreground",
  },
]

export function ScanSummary({ result }: ScanSummaryProps) {
  const hasIssues = result.summary.total > 0
  const scanDate = new Date(result.scannedAt)
  const safetyRating = getSafetyRating(result.summary, result.findings)

  const safetyConfig = {
    safe: {
      label: "Safe to Visit",
      description: "No exploitable vulnerabilities detected. This website is safe to browse. Any findings below are hardening recommendations.",
      icon: ShieldCheck,
      iconColor: "text-emerald-500",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/30",
      textColor: "text-emerald-600 dark:text-emerald-400",
    },
    caution: {
      label: "Visit with Caution",
      description: "Potential security concerns detected that could affect your safety. Review the findings below before entering sensitive information.",
      icon: ShieldAlert,
      iconColor: "text-yellow-500",
      bg: "bg-yellow-500/10",
      border: "border-yellow-500/30",
      textColor: "text-yellow-600 dark:text-yellow-400",
    },
    unsafe: {
      label: "Unsafe - Active Threats Detected",
      description: "Actively exploitable vulnerabilities were found. Avoid entering any personal or sensitive information on this website.",
      icon: ShieldX,
      iconColor: "text-red-500",
      bg: "bg-red-500/10",
      border: "border-red-500/30",
      textColor: "text-red-600 dark:text-red-400",
    },
  }

  const config = safetyConfig[safetyRating]
  const SafetyIcon = config.icon

  return (
    <div className="flex flex-col gap-4">
      {/* Safety Rating Banner */}
      <div
        className={cn(
          "flex items-start gap-3 rounded-xl border p-4",
          config.bg,
          config.border,
        )}
      >
        <div className={cn("flex items-center justify-center w-10 h-10 rounded-lg shrink-0", config.bg)}>
          <SafetyIcon className={cn("h-6 w-6", config.iconColor)} />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className={cn("text-sm font-semibold", config.textColor)}>
            {config.label}
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {config.description}
          </p>
        </div>
      </div>

      {/* Status banner */}
      <div
        className={cn(
          "flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4",
          hasIssues
            ? "bg-orange-500/5 border-orange-500/20"
            : "bg-emerald-500/5 border-emerald-500/20",
        )}
      >
        <div className="flex items-center gap-3">
          {hasIssues ? (
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-orange-500/10 shrink-0">
              <ShieldAlert className="h-5 w-5 text-orange-500" />
            </div>
          ) : (
            <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-foreground">
              {hasIssues
                ? `${result.summary.total} issue${result.summary.total === 1 ? "" : "s"} found`
                : "Looking good! No issues found."}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <ExternalLink className="h-3 w-3" />
                <span className="truncate max-w-[200px] sm:max-w-none">{result.url}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {(result.duration / 1000).toFixed(1)}s
              </span>
              <span className="hidden sm:inline">
                {scanDate.toLocaleDateString()} {scanDate.toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Severity cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {severityCards.map(({ key, label, icon: Icon, color, bg, border, accent }) => {
          const count = result.summary[key]
          return (
            <div
              key={key}
              className={cn(
                "relative flex items-center gap-3 rounded-xl border p-3 sm:flex-col sm:items-center sm:gap-1.5 sm:p-3 overflow-hidden",
                bg,
                border,
              )}
            >
              {count > 0 && (
                <div className={cn("absolute top-0 left-0 w-1 h-full sm:w-full sm:h-1", accent)} />
              )}
              <Icon className={cn("h-4 w-4 shrink-0", color)} />
              <div className="flex items-baseline gap-2 sm:flex-col sm:items-center sm:gap-0">
                <span className="text-lg font-bold text-foreground leading-none">
                  {count}
                </span>
                <span className={cn("text-xs font-medium", color)}>{label}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
