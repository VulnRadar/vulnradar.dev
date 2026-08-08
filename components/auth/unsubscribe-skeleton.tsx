import { Skeleton } from "@/components/ui/skeleton";

const GROUP_ROW_COUNTS = [5, 4, 4, 4, 2];

/**
 * Mirrors UnsubscribeContent's real layout (title, then grouped rows of
 * toggles) so the outer Suspense fallback and the token-fetch loading state
 * render the same shape instead of two different spinners in a row.
 */
export function UnsubscribeSkeleton() {
  return (
    <div
      className="space-y-8"
      role="status"
      aria-live="polite"
      aria-label="Loading email preferences"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="space-y-6">
        {GROUP_ROW_COUNTS.map((rowCount, gi) => (
          <div key={gi} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <div className="divide-y divide-border/40 rounded-lg border border-border/50 overflow-hidden">
              {Array.from({ length: rowCount }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-full max-w-[36ch]" />
                  </div>
                  <Skeleton className="h-5 w-9 rounded-full shrink-0 mt-0.5" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
