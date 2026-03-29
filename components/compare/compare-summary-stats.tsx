"use client"

import { Plus, Minus, Equal } from "lucide-react"

interface CompareSummaryStatsProps {
  added: number
  removed: number
  unchanged: number
}

export function CompareSummaryStats({ added, removed, unchanged }: CompareSummaryStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="rounded-xl border border-border/50 bg-card/50 p-5 flex flex-col items-center gap-2">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-destructive/10">
          <Plus className="h-5 w-5 text-destructive" />
        </div>
        <span className="text-3xl font-bold tabular-nums text-destructive">{added}</span>
        <span className="text-sm text-muted-foreground">New Issues</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/50 p-5 flex flex-col items-center gap-2">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10">
          <Minus className="h-5 w-5 text-emerald-500" />
        </div>
        <span className="text-3xl font-bold tabular-nums text-emerald-500">{removed}</span>
        <span className="text-sm text-muted-foreground">Fixed</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/50 p-5 flex flex-col items-center gap-2">
        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted">
          <Equal className="h-5 w-5 text-muted-foreground" />
        </div>
        <span className="text-3xl font-bold tabular-nums">{unchanged}</span>
        <span className="text-sm text-muted-foreground">Unchanged</span>
      </div>
    </div>
  )
}
