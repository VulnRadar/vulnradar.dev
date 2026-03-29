"use client"

import { Loader2, Globe, CheckCircle2, ChevronRight } from "lucide-react"
import { cn } from "@/lib/ui/utils"
import { type ScanOption, displayUrl, getRelativeTime } from "./compare-types"

interface CompareScanPickerProps {
  title: string
  step: number
  hint: string
  scans: ScanOption[]
  selected: number | null
  loading: boolean
  locked?: boolean
  lockedMessage?: string
  onSelect: (id: number) => void
}

export function CompareScanPicker({
  title,
  step,
  hint,
  scans,
  selected,
  loading,
  locked,
  lockedMessage,
  onSelect,
}: CompareScanPickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-semibold shrink-0">
          {step}
        </span>
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">({hint})</span>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : locked ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-4 gap-2">
            <ChevronRight className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{lockedMessage}</p>
          </div>
        ) : scans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-4 gap-2">
            <Globe className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No scans available</p>
            <p className="text-xs text-muted-foreground/60">Run another scan to compare</p>
          </div>
        ) : (
          <div className="flex flex-col max-h-[400px] overflow-y-auto divide-y divide-border/50">
            {scans.map((scan) => (
              <button
                key={scan.id}
                onClick={() => onSelect(scan.id)}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 text-left transition-colors",
                  selected === scan.id
                    ? "bg-primary/5 border-l-2 border-l-primary"
                    : "hover:bg-muted/50"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate font-mono">{displayUrl(scan.url)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-muted-foreground">{getRelativeTime(scan.scanned_at)}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className={cn(
                      "text-xs font-medium",
                      scan.findings_count === 0 ? "text-emerald-500" : "text-foreground"
                    )}>
                      {scan.findings_count} {scan.findings_count === 1 ? "issue" : "issues"}
                    </span>
                  </div>
                </div>
                {selected === scan.id && (
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
