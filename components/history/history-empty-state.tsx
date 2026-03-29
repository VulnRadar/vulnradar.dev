"use client"

import { Clock, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

interface HistoryEmptyStateProps {
  hasScans: boolean
  hasFilters: boolean
  onClearFilters: () => void
}

export function HistoryEmptyState({ hasScans, hasFilters, onClearFilters }: HistoryEmptyStateProps) {
  if (!hasScans) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center rounded-xl border border-dashed border-border bg-card/30">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
          <Clock className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">No scan history yet</p>
          <p className="text-xs text-muted-foreground">
            Scans you run will appear here automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" className="bg-transparent" asChild>
          <a href="/dashboard">Run Your First Scan</a>
        </Button>
      </div>
    )
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl border border-dashed border-border">
        <Search className="h-6 w-6 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">
          No scans match your search
        </p>
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </div>
    )
  }

  return null
}
