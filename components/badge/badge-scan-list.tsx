"use client"

import { Search, ShieldCheck, AlertTriangle, ChevronRight } from "lucide-react"
import { cn } from "@/lib/ui/utils"
import { type ScanEntry, getSeverityColor, getSeverityBg, getSeverityLabel, getRelativeTime, getHostname } from "./badge-types"

interface BadgeScanListProps {
  scans: ScanEntry[]
  selected: ScanEntry | null
  searchQuery: string
  onSearchChange: (query: string) => void
  onSelect: (scan: ScanEntry) => void
}

export function BadgeScanList({ scans, selected, searchQuery, onSearchChange, onSelect }: BadgeScanListProps) {
  const filteredScans = scans.filter((s) => {
    if (!searchQuery) return true
    return getHostname(s.url).toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Select a scan</h2>
        <span className="text-xs text-muted-foreground">{scans.length} scans</span>
      </div>

      {scans.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by domain..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
          />
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
          {filteredScans.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No scans match your search.</p>
          ) : (
            filteredScans.map((scan) => {
              const hostname = getHostname(scan.url)
              const isSelected = selected?.id === scan.id
              return (
                <button
                  key={scan.id}
                  type="button"
                  onClick={() => onSelect(scan)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 text-left transition-colors w-full group",
                    isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                  )}
                >
                  <div className={cn("flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0", getSeverityBg(scan))}>
                    {scan.findings_count === 0 ? (
                      <ShieldCheck className={cn("h-4 w-4", getSeverityColor(scan))} />
                    ) : (
                      <AlertTriangle className={cn("h-4 w-4", getSeverityColor(scan))} />
                    )}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium text-foreground truncate">{hostname}</span>
                    <span className="text-xs text-muted-foreground">{getRelativeTime(scan.scanned_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", getSeverityBg(scan), getSeverityColor(scan))}>
                      {getSeverityLabel(scan)}
                    </span>
                    <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform", isSelected && "text-primary rotate-90")} />
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
