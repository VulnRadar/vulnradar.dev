"use client";

import { Globe, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";

interface AssetsEmptyStateProps {
  hasAssets: boolean;
  hasFilter: boolean;
  onClearFilter: () => void;
}

export function AssetsEmptyState({
  hasAssets,
  hasFilter,
  onClearFilter,
}: AssetsEmptyStateProps) {
  if (!hasAssets) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-14 text-center">
        <Globe aria-hidden className="h-6 w-6 text-muted-foreground/60" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-foreground">No assets yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Every host you scan shows up here once, no matter how many times you
            rescan it.
          </p>
        </div>
        <Button asChild size="sm" className="mt-1">
          <a href={ROUTES.DASHBOARD}>
            <Globe aria-hidden className="mr-2 h-3.5 w-3.5" />
            Scan your first host
          </a>
        </Button>
      </div>
    );
  }

  if (hasFilter) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-card/50 px-4 py-12 text-center">
        <Search aria-hidden className="h-5 w-5 text-muted-foreground/50" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            Nothing matches that search
          </p>
          <p className="text-xs text-muted-foreground">
            Try a different hostname fragment.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onClearFilter}
          className="mt-1 bg-transparent"
        >
          Clear search
        </Button>
      </div>
    );
  }

  return null;
}
