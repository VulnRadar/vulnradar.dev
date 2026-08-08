"use client";

import { ScanSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";

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
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-14 text-center">
        <ScanSearch aria-hidden className="h-6 w-6 text-muted-foreground/60" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">
            No scans recorded yet
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Every scan you run gets saved here automatically: findings, tags,
            notes, kept for as long as your plan allows.
          </p>
        </div>
        <Button asChild size="sm" className="mt-1">
          <a href={ROUTES.DASHBOARD}>
            <ScanSearch aria-hidden className="mr-2 h-3.5 w-3.5" />
            Run your first scan
          </a>
        </Button>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-12 text-center">
        <Search aria-hidden className="h-5 w-5 text-muted-foreground/50" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            Nothing matches that filter
          </p>
          <p className="text-xs text-muted-foreground">
            Try a different URL fragment or tag.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilters}
          className="mt-1 bg-transparent"
        >
          Clear filters
        </Button>
      </div>
    );
  }

  return null;
}
