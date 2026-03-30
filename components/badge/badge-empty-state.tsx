import { ShieldCheck } from "lucide-react"

export function BadgeEmptyState() {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-muted">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No scans available</p>
          <p className="text-sm text-muted-foreground mt-1">
            Run a scan first, then come back here to generate your badge.
          </p>
        </div>
      </div>
    </div>
  )
}
