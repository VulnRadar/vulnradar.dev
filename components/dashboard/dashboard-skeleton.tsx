import { Skeleton } from "@/components/ui/skeleton";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { DashboardSkeleton as ScanDashboardSkeleton } from "@/components/scanner/dashboard";
import { SCAN_AUTH } from "@/lib/config/client-constants";

const MODE_TAB_COUNT = 3;

/** A toggle row: icon, label, and a switch pinned right. ScanForm renders
 *  three of these (privacy, screenshot, port sweep) and each is 36px tall,
 *  so leaving them out of the placeholder cost over a hundred pixels. */
function ToggleRowSkeleton({ topBorder = false }: { topBorder?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2.5 border-border px-3 py-2 ${
        topBorder ? "border-t" : "border-b bg-muted/10"
      }`}
    >
      <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="ml-auto h-5 w-9 rounded-full" />
    </div>
  );
}

/**
 * Mirrors DashboardContent's idle-state layout (hero, scan form, recent
 * activity). Everything this page shows is behind the same Suspense boundary
 * (DashboardContent reads useSearchParams), so unlike /assets or /repos there
 * is no static chrome to hoist out: the whole body is the waiting region.
 * The recent-activity portion reuses ScanDashboardSkeleton, the same skeleton
 * the Dashboard panel itself shows while it fetches its own data, so nothing
 * reflows once that panel mounts.
 *
 * The scan-form card is drawn row by row rather than as a mode strip over a
 * single input: the real card also carries the privacy toggle, the sign-in
 * disclosure, the screenshot toggle and the port-sweep toggle, so the short
 * version pushed the whole activity panel below it down by roughly 160px the
 * instant the page hydrated. It is also rounded-xl, not rounded-md: the card
 * is a panel, and the skeleton was drawing it at control radius.
 *
 * `block` overrides SkeletonRegion's default flex column: the real main is a
 * plain block box, and a gap-5 between these three would space them where the
 * page has nothing.
 */
export function DashboardDataSkeleton() {
  return (
    <SkeletonRegion label="Loading scanner" className="block">
      <div className="pt-8 pb-5 sm:pt-10">
        <Skeleton className="h-7 w-40 sm:h-8" />
        {/* ScanHero's subtitle wraps to two lines at every width where
            max-w-2xl applies, so one bar was a line short. */}
        <div className="mt-1.5 max-w-2xl space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1.5">
          {Array.from({ length: MODE_TAB_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-md" />
          ))}
        </div>

        <ToggleRowSkeleton />

        <div className="flex flex-col gap-2 p-2 sm:flex-row sm:p-2.5">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-11 w-20 shrink-0 rounded-md" />
            <Skeleton className="h-11 w-20 shrink-0 rounded-md" />
            <Skeleton className="h-11 flex-1 rounded-md sm:w-28 sm:flex-none" />
          </div>
        </div>

        {SCAN_AUTH.ENABLED && (
          <div className="border-t border-border px-3 py-2.5">
            <Skeleton className="h-5 w-48" />
          </div>
        )}

        <ToggleRowSkeleton topBorder />
        <ToggleRowSkeleton topBorder />
      </div>

      <ScanDashboardSkeleton />
    </SkeletonRegion>
  );
}

/**
 * The same shape inside the app chrome, for app/dashboard/loading.tsx, which
 * runs before the page component exists and so has no Header to keep.
 * `pb-16` and no top padding is the page's own measurement: the hero above
 * carries the top spacing itself.
 */
export function DashboardRouteSkeleton() {
  return (
    <AppPageShell padding="pb-16">
      <DashboardDataSkeleton />
    </AppPageShell>
  );
}
