import { AppPageShell } from "@/components/shared/app-page-shell";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";
import { HistoryViewTabs } from "./history-view-tabs";
import { HistoryDetailSkeleton } from "./history-detail-skeleton";

const ROW_COUNT = 6;

/**
 * HistoryFilters exists the moment the account has a single scan, and this
 * skeleton did not draw it at all, so the list below jumped a whole control
 * row down every time data landed.
 *
 * Three triggers, not four: the tag dropdown only renders once the account has
 * tags, so three (severity, date, sort) is the floor that is always there.
 */
function HistoryFiltersSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <Skeleton className="h-10 min-w-[12rem] flex-1" />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>
    </div>
  );
}

/**
 * The rows carry HistoryScanRow's own container classes verbatim rather than a
 * simplified flex row. That is the only way the two agree at both widths: the
 * real row stacks into an icon/URL block plus a meta line below sm and becomes
 * a six-track grid above it, and the flat `flex items-center` copy that used to
 * live here was roughly 50px short per row on a phone.
 */
function HistoryScanListSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* The desktop column-header band. It is static, it is ~37px tall, and
          leaving it out meant the first row sat that much too high until the
          list arrived. The width classes are the real ones because they are
          what size the grid's auto tracks. */}
      <div className="hidden sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-4 border-b border-border bg-muted/30 px-4 py-2.5">
        <span className="w-9" aria-hidden />
        <Skeleton className="h-3.5 w-14" />
        <div className="flex w-20 justify-center">
          <Skeleton className="h-3.5 w-12" />
        </div>
        <div className="flex w-40 justify-center">
          <Skeleton className="h-3.5 w-14" />
        </div>
        <div className="flex w-20 justify-end">
          <Skeleton className="h-3.5 w-14" />
        </div>
        <span className="w-12" aria-hidden />
      </div>

      <div className="divide-y divide-border">
        {Array.from({ length: ROW_COUNT }).map((_, i) => (
          <div
            key={i}
            // border-l-2 is the severity rail every loaded row carries. Drawn
            // transparent so the row keeps the 2px inset without this file
            // having to invent a severity it cannot know yet.
            className="flex flex-col gap-3 border-l-2 border-transparent py-3.5 pl-4 pr-16 sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] sm:items-center sm:gap-4 sm:pr-4"
          >
            {/* sm:contents unwraps this into two grid cells above sm, exactly
                as the real row does, so the icon and the target block land in
                their own tracks instead of sharing one. */}
            <div className="flex items-center gap-3 sm:contents">
              <Skeleton className="h-9 w-9 rounded-md shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-32 sm:hidden" />
                {/* ScanTags always renders, tags or not: it carries the
                    add-a-tag control. */}
                <Skeleton className="mt-0.5 h-4 w-14 rounded-md" />
              </div>
            </div>

            {/* Source. Was drawn as an h-5 bordered badge, which the row
                stopped being: it is plain uppercase micro-text now. */}
            <div className="hidden w-20 items-center justify-center sm:flex">
              <Skeleton className="h-3 w-8" />
            </div>

            {/* Findings: severity pills, or one "Clean" chip. */}
            <div className="hidden w-40 items-center justify-center gap-1 sm:flex">
              <Skeleton className="h-5 w-12 rounded-md" />
              <Skeleton className="h-5 w-12 rounded-md" />
            </div>

            <div className="hidden w-20 items-center justify-end sm:flex">
              <Skeleton className="h-3 w-12" />
            </div>

            {/* Actions are a hover-revealed menu button above sm, so this
                column is reserved rather than drawn. */}
            <div className="hidden w-12 shrink-0 sm:block" aria-hidden />

            {/* Mobile meta line: source, time, findings summary. */}
            <div className="ml-12 flex items-center justify-between gap-2 sm:hidden">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-20" />
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
 * app/history/loading.tsx renders before the page component exists, so it needs
 * the whole chrome. The page's own loading branch renders while that chrome is
 * already on screen, so drawing it again would tear down a Header and a tab
 * strip the user can see. The old single export did the second thing in both
 * places.
 */
export function HistoryDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your scan history">
      {/* The real strip's own placeholder, not a local copy of it. The copy
          that lived here drew the container at rounded-md with a rounded-lg
          icon nested inside, so the placeholder had a larger radius than its
          own container and neither matched the rounded-xl StatStrip that
          actually arrives. Same drift /shares already had. */}
      <StatStripSkeleton />
      <HistoryFiltersSkeleton />
      <HistoryScanListSkeleton />
    </SkeletonRegion>
  );
}

/**
 * The other half of the route fallback, for /history?scan=X.
 *
 * app/history/loading.tsx has to pick one of these before the page's own code
 * exists, and it used to pick the list every time. So opening a scan by URL
 * drew the list placeholder, then the page mounted and drew the detail
 * placeholder: two different shapes for one navigation. This is the shape
 * HistoryPage's detail branch renders (the tab strip, then
 * HistoryDetailSkeleton), so the two agree and only one is ever painted.
 */
export function HistoryDetailRouteSkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      <HistoryViewTabs />
      <HistoryDetailSkeleton />
    </AppPageShell>
  );
}

export function HistorySkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* The real tab strip, not a grey bar in its place. It needs no data, it
          is live navigation while the list loads, and its absence here was the
          same bug /assets had: the strip appeared on load and shoved the whole
          table down. */}
      <HistoryViewTabs />

      <div className="mb-1 flex flex-col gap-3 pb-2 pt-6 sm:flex-row sm:items-start sm:justify-between sm:pt-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-28 sm:h-8" />
          <Skeleton className="h-5 w-64 max-w-full" />
        </div>
        {/* Clear all history, which lives in this row on the loaded page and
            was missing here. Above sm the title block is taller so it changes
            nothing; below sm it is a second row, and omitting it moved
            everything under it. */}
        <Skeleton className="h-9 w-40 shrink-0 self-start" />
      </div>

      <HistoryDataSkeleton />
    </AppPageShell>
  );
}
