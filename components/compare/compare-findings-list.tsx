"use client"

import { AlertTriangle, CheckCircle2, Equal, Shield } from "lucide-react"
import { cn } from "@/lib/ui/utils"
import { type DiffResult, severityColors, severityTextColors } from "./compare-types"

interface CompareFindingsListProps {
  diff: DiffResult["diff"]
}

function FindingRow({
  title,
  severity,
  variant,
}: {
  title: string
  severity: string
  variant: "added" | "removed" | "unchanged"
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
      <span
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          severityColors[severity],
          variant === "removed" && "opacity-50"
        )}
      />
      <span
        className={cn(
          "flex-1 text-sm",
          variant === "removed" && "line-through opacity-60",
          variant === "unchanged" && "text-muted-foreground"
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "text-xs font-medium uppercase",
          variant === "added" ? severityTextColors[severity] : "text-muted-foreground"
        )}
      >
        {severity}
      </span>
    </div>
  )
}

export function CompareFindingsList({ diff }: CompareFindingsListProps) {
  const allClean = diff.added.length === 0 && diff.removed.length === 0

  return (
    <div className="flex flex-col gap-4">
      {allClean && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 flex items-center gap-4">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 shrink-0">
            <Shield className="h-6 w-6 text-emerald-500" />
          </div>
          <div>
            <p className="text-base font-semibold text-emerald-500">No Changes Detected</p>
            <p className="text-sm text-muted-foreground">The security state is identical between these two scans.</p>
          </div>
        </div>
      )}

      {diff.added.length > 0 && (
        <div className="rounded-xl border border-destructive/20 bg-card/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-destructive/5 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="font-semibold text-destructive">New Issues</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive ml-1">
                {diff.added.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Issues that appeared in the newer scan</p>
          </div>
          <div className="divide-y divide-border/50">
            {diff.added.map((f, i) => (
              <FindingRow key={i} title={f.title} severity={f.severity} variant="added" />
            ))}
          </div>
        </div>
      )}

      {diff.removed.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-card/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 bg-emerald-500/5 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-semibold text-emerald-500">Fixed Issues</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500 ml-1">
                {diff.removed.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Issues that were resolved since the base scan</p>
          </div>
          <div className="divide-y divide-border/50">
            {diff.removed.map((f, i) => (
              <FindingRow key={i} title={f.title} severity={f.severity} variant="removed" />
            ))}
          </div>
        </div>
      )}

      {diff.unchanged.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
          <div className="px-5 py-4 border-b border-border/50 flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Equal className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold">Unchanged Issues</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground ml-1">
                {diff.unchanged.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Issues present in both scans</p>
          </div>
          <div className="divide-y divide-border/50 max-h-[300px] overflow-y-auto">
            {diff.unchanged.map((f, i) => (
              <FindingRow key={i} title={f.title} severity={f.severity} variant="unchanged" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
