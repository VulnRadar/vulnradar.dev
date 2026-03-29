"use client"

import { ArrowRight, Clock, TrendingDown, TrendingUp, Equal } from "lucide-react"
import { type DiffResult, displayUrl, formatDate, formatTime, getRelativeTime } from "./compare-types"

interface CompareHeaderProps {
  result: DiffResult
}

export function CompareHeader({ result }: CompareHeaderProps) {
  const delta = result.scanB.findings_count - result.scanA.findings_count

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] divide-y md:divide-y-0 md:divide-x divide-border/50">
        {/* Base scan */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wide">
              Base
            </span>
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{getRelativeTime(result.scanA.scanned_at)}</span>
          </div>
          <p className="text-sm font-medium font-mono truncate mb-2">{displayUrl(result.scanA.url)}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{result.scanA.findings_count}</span>
            <span className="text-sm text-muted-foreground">issues</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {formatDate(result.scanA.scanned_at)} at {formatTime(result.scanA.scanned_at)}
          </p>
        </div>

        {/* Change indicator */}
        <div className="flex items-center justify-center p-5 bg-muted/20">
          <div className="flex flex-col items-center gap-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground hidden md:block" />
            {delta < 0 ? (
              <div className="flex items-center gap-1.5 text-emerald-500">
                <TrendingDown className="h-4 w-4" />
                <span className="text-sm font-semibold">{Math.abs(delta)} fewer</span>
              </div>
            ) : delta > 0 ? (
              <div className="flex items-center gap-1.5 text-destructive">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm font-semibold">+{delta} more</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Equal className="h-4 w-4" />
                <span className="text-sm font-semibold">no change</span>
              </div>
            )}
          </div>
        </div>

        {/* Compare scan */}
        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary uppercase tracking-wide">
              Compare
            </span>
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{getRelativeTime(result.scanB.scanned_at)}</span>
          </div>
          <p className="text-sm font-medium font-mono truncate mb-2">{displayUrl(result.scanB.url)}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">{result.scanB.findings_count}</span>
            <span className="text-sm text-muted-foreground">issues</span>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {formatDate(result.scanB.scanned_at)} at {formatTime(result.scanB.scanned_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
