import { Skeleton } from "@/components/ui/skeleton";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";

const ROW_COUNT = 5;

/** The four-track layout BadgeScanList's header band and every row key off. */
const GRID = "sm:grid-cols-[2rem_minmax(0,1fr)_auto_1rem]";

/**
 * The two columns BadgePage fills once its scans arrive: BadgeScanList's rows
 * on the left, and BadgePreview's empty "pick a scan" frame on the right,
 * since nothing is selected the moment loading finishes.
 *
 * The page's own header is not here. It is a fixed H1 and a fixed paragraph,
 * so the page prints it on the first frame instead. That is also the fix for a
 * drift this file was carrying: it had its own copy of the intro paragraph,
 * and the copy said the badge "does not refresh itself" while the page it
 * stood in for says the badge updates every time you rescan the URL. Two
 * contradictory answers to the same question, half a second apart.
 */
export function BadgeDataSkeleton() {
  return (
    <SkeletonRegion
      label="Loading your scans"
      className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start"
    >
      {/* Scan list */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-14" />
        </div>

        {/* BadgeScanList only shows its filter above three scans, so this bar
            is a bet either way: drawn, it costs the smallest accounts a small
            upward shift; left out, every account with a filter gets the same
            shift downward. Drawn, because the list is capped at 50 scans and
            most accounts that reach this page have more than three. rounded-md,
            not rounded-lg: it is a control, and the real one moved down to the
            control rung of the radius ladder without this following it. */}
        <Skeleton className="h-10 w-full rounded-md" />

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* The desktop column-header band (SCAN / RATING). Without it every
              row sat ~37px too high until the scans arrived. */}
          <div
            className={`hidden gap-3 border-b border-border bg-muted/30 px-4 py-2.5 sm:grid ${GRID}`}
          >
            <span aria-hidden />
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 w-12" />
            <span aria-hidden />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: ROW_COUNT }).map((_, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 sm:grid sm:items-center ${GRID}`}
              >
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full shrink-0" />
                {/* The row's trailing chevron, which the real list draws and
                    this placeholder used to end one glyph short of. */}
                <Skeleton className="h-4 w-4 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-28" />
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The same region inside the app chrome, for app/badge/loading.tsx, which
 *  runs before BadgePage exists and so has no header of its own to keep. */
export function BadgeSkeleton() {
  return (
    <AppPageShell maxWidth="max-w-5xl" padding="py-8 sm:py-10">
      <div className="mb-8 max-w-xl">
        <Skeleton className="h-7 w-24 sm:h-8" />
        {/* Three lines: the real intro wraps to three inside max-w-xl. */}
        <div className="mt-2 space-y-2.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
      <BadgeDataSkeleton />
    </AppPageShell>
  );
}
