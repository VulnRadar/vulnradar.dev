"use client"

import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  color: string
  accent: string
}

export function StatCard({ label, value, icon: Icon, color, accent }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:shadow-md hover:border-primary/20">
      {/* Accent gradient bar */}
      <div className={cn("absolute top-0 left-0 w-full h-1 opacity-80", accent)} />
      
      {/* Subtle background glow on hover */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
        "bg-gradient-to-br from-primary/[0.02] to-transparent"
      )} />
      
      <div className="relative flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
          <div className={cn(
            "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
            "bg-muted/50 group-hover:bg-primary/10"
          )}>
            <Icon className={cn("h-4 w-4 transition-colors", color, "group-hover:text-primary")} />
          </div>
        </div>
        <span className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight tabular-nums">
          {Number(value).toLocaleString()}
        </span>
      </div>
    </div>
  )
}
