import { Skeleton } from "@/components/ui/skeleton";
import { ScanDetailSkeleton } from "@/components/scanner/scan-detail-skeleton";

/**
 * Mirrors SharedScanPage's (and HostReportPage's -- app/host/[hostname])
 * real layout: the back link, the header card, and then whatever
 * ScanResultDetail renders, which is ScanDetailSkeleton's job. Everything
 * below the header used to be a second copy of the history detail skeleton;
 * the two had already drifted apart on their finding-row count.
 */
export function SharedScanSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-live="polite"
      aria-label="Loading report"
    >
      {/* The Back link above the header card. It was missing, so the whole
          report sat 54px too high and then dropped. */}
      <Skeleton className="h-[34px] w-28 rounded-md" />

      {/* Header card */}
      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-3 w-64" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* One bar, not two: the loaded card has the h1 alone here, so the
              second line was a row this page never renders. */}
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
        </div>
      </div>

      <ScanDetailSkeleton />

      {/* The signup CTA the loaded page ends with. */}
      <Skeleton className="h-[110px] w-full rounded-xl" />
    </div>
  );
}
