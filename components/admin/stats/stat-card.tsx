"use client"

import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface StatCardProps {
  label: string
  value: string | number
  icon: LucideIcon
  color: string
  accent: string
  trend?: { value: number; positive: boolean }
  className?: string
}

export function StatCard({ label, value, icon: Icon, color, accent, trend, className }: StatCardProps) {
  const displayValue = typeof value === "number" ? value.toLocaleString() : Number(value).toLocaleString()
  
  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl border border-border bg-card p-5 flex flex-col gap-3 transition-all hover:border-border/80 hover:shadow-lg hover:shadow-black/5",
      className
    )}>
      {/* Top accent bar */}
      <div className={cn("absolute top-0 left-0 w-full h-1", accent)} />
      
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center bg-muted/50")}>
          <Icon className={cn("h-5 w-5", color)} />
        </div>
      </div>
      
      {/* Value */}
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-foreground tracking-tight">{displayValue}</span>
        {trend && (
          <span className={cn(
            "text-xs font-medium mb-1",
            trend.positive ? "text-emerald-500" : "text-destructive"
          )}>
            {trend.positive ? "+" : ""}{trend.value}%
          </span>
        )}
      </div>
    </div>
  )
}
