import { Skeleton } from "@/components/ui/skeleton";

const STAT_COUNT = 3;
const FINDING_ROW_COUNT = 5;

/**
 * Mirrors SharedScanPage's (and HostReportPage's -- app/host/[hostname])
 * real layout: header card with the verdict, ScanSummary's stat card, the
 * "more about this host" block, and the findings list. So the fetch's
 * loading state doesn't reflow into a differently-shaped report once it
 * resolves, for either public no-login report page.
 */
export function SharedScanSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-live="polite"
      aria-label="Loading report"
    >
      {/* Header card */}
      <div className="rounded-md border border-border bg-card p-5 sm:p-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-border/60 pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      {/* ScanSummary */}
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="grid grid-cols-1 gap-5 py-4 pl-5 pr-4 sm:py-5 sm:pl-6 sm:pr-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-full max-w-xs" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-16 w-full rounded-md" />
        </div>
        <div className="flex flex-wrap items-stretch divide-x divide-border border-t border-border bg-muted/30">
          {Array.from({ length: STAT_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex min-w-0 flex-1 basis-24 items-center gap-2.5 px-3 py-2 sm:px-4"
            >
              <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* "More about this host" */}
      <div className="flex flex-col gap-3 border-t border-border/50 pt-5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-24 w-full rounded-md" />
      </div>

      {/* Findings list */}
      <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
        {Array.from({ length: FINDING_ROW_COUNT }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-5 w-16 rounded shrink-0" />
            <Skeleton className="h-4 flex-1 min-w-0" />
            <Skeleton className="h-4 w-4 rounded shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
