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
  const displayValue = typeof value === "number" ? value.toLocaleString() : (Number(value) ? Number(value).toLocaleString() : value)
  
  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-4 flex flex-col transition-all duration-300 hover:border-border hover:shadow-xl hover:shadow-black/5 hover:-translate-y-0.5",
      className
    )}>
      {/* Top accent bar */}
      <div className={cn("absolute top-0 left-0 right-0 h-0.5 opacity-80", accent)} />
      
      {/* Glow effect on hover */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500",
        accent.replace("bg-", "bg-") + "/5"
      )} />
      
      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className={cn(
            "h-9 w-9 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110",
            accent.replace("bg-", "bg-") + "/10"
          )}>
            <Icon className={cn("h-4 w-4", color)} />
          </div>
          {trend && (
            <span className={cn(
              "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
              trend.positive 
                ? "bg-emerald-500/10 text-emerald-500" 
                : "bg-destructive/10 text-destructive"
            )}>
              {trend.positive ? "+" : ""}{trend.value}%
            </span>
          )}
        </div>
        
        {/* Value */}
        <p className="text-2xl font-bold text-foreground tracking-tight mb-0.5">
          {displayValue}
        </p>
        <p className="text-[11px] text-muted-foreground font-medium">
          {label}
        </p>
      </div>
    </div>
  )
}
