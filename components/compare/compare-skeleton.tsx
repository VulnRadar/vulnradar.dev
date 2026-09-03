import { AppPageShell } from "@/components/shared/app-page-shell";
import {
  SkeletonRegion,
  SkeletonRows,
} from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Five, matching CompareHostPicker's own ROW_COUNT. This drew four, so the
 * route transition's list was one row shorter than the list the picker draws
 * for the same wait, and the page grew by a row the moment ComparePage
 * mounted.
 */
const HOST_ROW_COUNT = 5;

/**
 * Two exports over one shape. app/compare/loading.tsx renders before
 * ComparePage exists and needs the chrome; CompareDataSkeleton is the region
 * on its own, for anything rendering inside a shell that is already mounted.
 *
 * Only the host list is a placeholder here. ComparePage's title and its filter
 * field are static, and once the page is mounted CompareHostPicker draws its
 * own waiting state, so this file exists purely for the gap before the route's
 * JavaScript has arrived.
 */
export function CompareDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your scans" className="gap-6">
      <Skeleton className="h-10 w-full max-w-sm" />
      {/* The picker's container is softer than the shared default (border and
          dividers at /50 over a card tint), so the placeholder matches it
          rather than drawing a harder box that then lightens. */}
      <SkeletonRows
        rows={HOST_ROW_COUNT}
        trailing={[4]}
        className="border-border/50 bg-card/50 divide-border/50"
      />
    </SkeletonRegion>
  );
}

export function CompareSkeleton() {
  return (
    <AppPageShell padding="py-8 sm:py-10" className="flex flex-col gap-8">
      <div className="max-w-2xl space-y-2.5">
        {/* h-7 rising to h-8: the h1 is text-xl sm:text-2xl, and a flat h-8
            bar overstated it by 4px on a phone. */}
        <Skeleton className="h-7 sm:h-8 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <CompareDataSkeleton />
    </AppPageShell>
  );
}
