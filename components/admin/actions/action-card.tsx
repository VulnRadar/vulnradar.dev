"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface ActionCardProps {
  icon: LucideIcon
  label: string
  description: string
  onClick: () => void
  variant?: "default" | "danger" | "warning" | "success" | "primary"
  disabled?: boolean
  loading?: boolean
  className?: string
}

export function ActionCard({ 
  icon: Icon, 
  label, 
  description, 
  onClick, 
  variant = "default",
  disabled,
  loading,
  className,
}: ActionCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case "danger":
        return "border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50"
      case "warning":
        return "border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50"
      case "success":
        return "border-emerald-500/30 hover:bg-emerald-500/10 hover:border-emerald-500/50"
      case "primary":
        return "border-primary/30 hover:bg-primary/10 hover:border-primary/50"
      default:
        return "border-border hover:bg-muted/50 hover:border-border"
    }
  }

  const getIconStyles = () => {
    switch (variant) {
      case "danger":
        return "bg-destructive/10 text-destructive"
      case "warning":
        return "bg-amber-500/10 text-amber-500"
      case "success":
        return "bg-emerald-500/10 text-emerald-500"
      case "primary":
        return "bg-primary/10 text-primary"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "flex items-center gap-3 p-4 rounded-xl border transition-all text-left w-full",
        getVariantStyles(),
        (disabled || loading) && "opacity-50 pointer-events-none",
        className
      )}
    >
      <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center shrink-0", getIconStyles())}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  )
}
