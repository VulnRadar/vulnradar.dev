import { AppPageShell } from "@/components/shared/app-page-shell";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_COUNT = 6;

/** The six-track layout SharesTable's header and SharesRow both key off. */
const GRID = "sm:grid-cols-[1fr_110px_100px_110px_120px_80px]";

/**
 * The rows carry SharesRow's own container classes verbatim. The flat
 * `flex items-center` copy that used to live here was right on desktop and
 * badly wrong on a phone, where the real row stacks six blocks (target,
 * status, findings, shared, expires, actions) into a column roughly three
 * times the height this drew.
 */
function SharesTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* The desktop column-header band, which this skeleton did not have, so
          every row sat ~37px too high until the table arrived. */}
      <div
        className={`hidden sm:grid ${GRID} gap-4 border-b border-border bg-muted/30 px-4 py-2.5`}
      >
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-12 justify-self-end" />
      </div>

      <div className="divide-y divide-border">
        {Array.from({ length: ROW_COUNT }).map((_, i) => (
          <div
            key={i}
            // border-l-2 is the severity rail the loaded row carries, drawn
            // transparent so the content keeps the same 2px inset.
            className={`flex flex-col gap-2 border-l-2 border-transparent py-3 pl-4 pr-4 sm:grid ${GRID} sm:items-center sm:gap-4 sm:py-3.5`}
          >
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            {/* Expires is a 44px touch target below sm and a compact link
                above it, so the wrapper carries that height, not the bar. */}
            <div className="flex min-h-11 items-center sm:min-h-0">
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="flex items-center justify-end gap-2 sm:gap-1">
              <Skeleton className="h-11 w-11 rounded-md sm:h-8 sm:w-8" />
              <Skeleton className="h-11 w-11 rounded-md sm:h-8 sm:w-8" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Two exports over one shape, because a skeleton has two callers that want
 * opposite things.
 *
 * app/shares/loading.tsx renders before the page component exists, so it needs
 * the whole chrome. The page's own loading branch renders while that chrome is
 * already on screen, so drawing it again would tear down a Header the user can
 * see. The old single export did the second thing in both places.
 */
export function SharesDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your shared reports">
      {/* The real stat strip's own placeholder, not a second hand-rolled copy
          of it: the old local SharesStatsSkeleton drew the strip at rounded-md
          with a rounded-lg icon nested inside it, so the placeholder had a
          larger radius than its own container and neither matched the
          rounded-xl strip that replaced it. */}
      <StatStripSkeleton />
      {/* Search plus the verdict and sort triggers. SharesFilters only renders
          above three links, so this bar is a bet either way: drawn, it costs
          the smallest accounts a small upward shift; left out, every account
          with a filter row gets the same shift downward. Drawn, because the
          page paginates at ten rows and an account that has bothered to mint
          share links usually has more than three. Same bet, same reasoning as
          components/badge/badge-skeleton.tsx. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Skeleton className="h-10 min-w-[12rem] flex-1 rounded-md" />
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-11 w-32 rounded-md sm:h-10" />
          <Skeleton className="h-11 w-36 rounded-md sm:h-10" />
        </div>
      </div>
      <SharesTableSkeleton />
    </SkeletonRegion>
  );
}

export function SharesSkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* The page's title block is static, so the page itself renders it for
          real. Here it is bars, because the page component has not mounted. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 pb-2 pt-2 sm:pt-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-44 sm:h-8" />
          <Skeleton className="h-5 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-10 w-44 shrink-0" />
      </div>
      <SharesDataSkeleton />
    </AppPageShell>
  );
}
