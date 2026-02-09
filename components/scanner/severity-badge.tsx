import { cn } from "@/lib/utils"
import type { Severity } from "@/lib/scanner/types"

const severityConfig: Record<
  Severity,
  { label: string; className: string }
> = {
  critical: {
    label: "Critical",
    className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
  },
  high: {
    label: "High",
    className: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  medium: {
    label: "Medium",
    className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
  },
  low: {
    label: "Low",
    className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20",
  },
  info: {
    label: "Info",
    className: "bg-muted text-muted-foreground border-border",
  },
}

interface SeverityBadgeProps {
  severity: Severity
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold",
        config.className,
        className,
      )}
    >
      {config.label}
    </span>
  )
}
