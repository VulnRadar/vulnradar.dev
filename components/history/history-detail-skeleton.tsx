import { Skeleton } from "@/components/ui/skeleton";
import { ScanDetailSkeleton } from "@/components/scanner/scan-detail-skeleton";

/**
 * Mirrors the detail panel's real layout (HistoryDetailHeader, then everything
 * ScanResultDetail renders) so switching a scan in from the list doesn't gate
 * the whole page, only reflows the panel that's actually replaced once
 * loadScanDetail resolves. The list sidebar/header around it stays mounted and
 * visible throughout.
 *
 * The body below the header comes from ScanDetailSkeleton, shared with
 * components/scanner/shared-scan-skeleton.tsx. The two files used to hold
 * identical copies of it and had already disagreed about how many finding rows
 * to draw.
 */
export function HistoryDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-live="polite"
      aria-label="Loading scan"
    >
      {/* HistoryDetailHeader. The back control is a 44px touch target below
          sm and shrinks to 28px above it, which the flat h-7 placeholder got
          wrong on exactly the viewport where a 16px jump is most visible. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-md sm:h-7 sm:w-7" />
          <Skeleton className="h-5 w-48" />
        </div>
        <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
      </div>

      <ScanDetailSkeleton />
    </div>
  );
}
