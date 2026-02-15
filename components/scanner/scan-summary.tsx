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
  ScanSearch,
} from "lucide-react"
import type { ScanResult } from "@/lib/scanner/types"
import { cn } from "@/lib/utils"
import { SEVERITY_LEVELS, TOTAL_CHECKS_LABEL } from "@/lib/constants"
import { getSafetyRating } from "@/lib/scanner/safety-rating"

interface ScanSummaryProps {
  result: ScanResult
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
  const safetyRating = getSafetyRating(result.findings)

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
              <span className="inline-flex items-center gap-1">
                <ScanSearch className="h-3 w-3" />
                {TOTAL_CHECKS_LABEL} checks run
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
