"use client"

import { AlertTriangle, Info, CheckCircle, XCircle, LucideIcon } from "lucide-react"
import { cn } from "@/lib/ui/utils"

type CalloutVariant = "info" | "warning" | "success" | "error"

const variantStyles: Record<CalloutVariant, { border: string; bg: string; icon: LucideIcon; iconColor: string }> = {
  info: {
    border: "border-blue-500/20",
    bg: "bg-blue-500/5",
    icon: Info,
    iconColor: "text-blue-600",
  },
  warning: {
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
  },
  success: {
    border: "border-green-500/20",
    bg: "bg-green-500/5",
    icon: CheckCircle,
    iconColor: "text-green-600",
  },
  error: {
    border: "border-red-500/20",
    bg: "bg-red-500/5",
    icon: XCircle,
    iconColor: "text-red-600",
  },
}

interface DocsCalloutProps {
  variant?: CalloutVariant
  title?: string
  children: React.ReactNode
  className?: string
}

export function DocsCallout({ variant = "info", title, children, className }: DocsCalloutProps) {
  const styles = variantStyles[variant]
  const Icon = styles.icon

  return (
    <div className={cn("rounded-lg border p-4 flex gap-3", styles.border, styles.bg, className)}>
      <Icon className={cn("h-5 w-5 flex-shrink-0 mt-0.5", styles.iconColor)} />
      <div className="text-xs text-muted-foreground">
        {title && <p className={cn("font-medium mb-1", styles.iconColor)}>{title}</p>}
        {children}
      </div>
    </div>
  )
}
