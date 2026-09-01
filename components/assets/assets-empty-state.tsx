"use client";

import { Globe, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
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

  if (hasFilter) {
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
