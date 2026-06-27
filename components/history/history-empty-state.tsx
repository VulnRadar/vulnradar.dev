"use client";

import { Clock, Search, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HistoryEmptyStateProps {
  hasScans: boolean;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function HistoryEmptyState({
  hasScans,
  hasFilters,
  onClearFilters,
}: HistoryEmptyStateProps) {
  if (!hasScans) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center rounded-xl border border-dashed border-border bg-card/30">
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
          <Clock className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">
            No scan history yet
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Scans you run will appear here automatically. Run your first scan to
            see results here.
          </p>
        </div>
        <Button asChild size="sm" className="mt-1">
          <a href="/dashboard">
            <ScanSearch className="h-3.5 w-3.5 mr-2" />
            Run your first scan
          </a>
        </Button>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center rounded-xl border border-dashed border-border bg-card/30">
        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
          <Search className="h-4 w-4 text-muted-foreground/60" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            No scans match your search
          </p>
          <p className="text-xs text-muted-foreground">
            Try a different URL or tag filter.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          className="bg-transparent mt-1"
        >
          Clear filters
        </Button>
      </div>
    );
  }

  return null;
}
