"use client";

import { Globe, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ROUTES } from "@/lib/config/client-constants";

interface AssetsEmptyStateProps {
  hasAssets: boolean;
  hasFilter: boolean;
  /**
   * Whether the active filter actually matched anything.
   *
   * hasFilter alone only means the box is non-empty, never that it matched
   * nothing, so typing a hostname fragment that DOES match stacked the
   * "Nothing matches that search" panel directly above the table listing the
   * matches. components/history/history-empty-state.tsx carries this same
   * prop, added for this same reason; the assets page never got it.
   */
  hasResults: boolean;
  onClearFilter: () => void;
}

export function AssetsEmptyState({
  hasAssets,
  hasFilter,
  hasResults,
  onClearFilter,
}: AssetsEmptyStateProps) {
  if (!hasAssets) {
    return (
      <EmptyState
        icon={Globe}
        title="No assets yet"
        description="Every host you scan shows up here once, no matter how many times you rescan it."
        action={
          <Button asChild size="sm">
            <a href={ROUTES.DASHBOARD}>
              <Globe aria-hidden className="mr-2 h-3.5 w-3.5" />
              Scan your first host
            </a>
          </Button>
        }
      />
    );
  }

  if (hasFilter && !hasResults) {
    return (
      <EmptyState
        icon={Search}
        size="sm"
        title="Nothing matches that search"
        description="Try a different hostname fragment."
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={onClearFilter}
            className="bg-transparent"
          >
            Clear search
          </Button>
        }
      />
    );
  }

  return null;
}
