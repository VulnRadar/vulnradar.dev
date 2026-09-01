"use client";

import { ScanSearch, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/lib/config/client-constants";

interface HistoryEmptyStateProps {
  hasScans: boolean;
  hasFilters: boolean;
  /** Whether the active filter actually matched any scans. When it did, this
   * component renders nothing so the "nothing matches" message never shows
   * above the matching results. */
  hasResults: boolean;
  onClearFilters: () => void;
}

export function HistoryEmptyState({
  hasScans,
  hasFilters,
  hasResults,
  onClearFilters,
}: HistoryEmptyStateProps) {
  if (!hasScans) {
    return (
      <EmptyState
        icon={ScanSearch}
        title="No scans recorded yet"
        description="Every scan you run gets saved here automatically: findings, tags, notes, kept for as long as your plan allows."
        action={
          <Button asChild size="sm">
            <a href={ROUTES.DASHBOARD}>
              <ScanSearch aria-hidden className="mr-2 h-3.5 w-3.5" />
              Run your first scan
            </a>
          </Button>
        }
      />
    );
  }

  if (hasFilters && !hasResults) {
    return (
      <EmptyState
        icon={Search}
        size="sm"
        title="Nothing matches that filter"
        description="Try a different URL fragment or tag."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={onClearFilters}
            className="bg-transparent"
          >
            Clear filters
          </Button>
        }
      />
    );
  }

  return null;
}
