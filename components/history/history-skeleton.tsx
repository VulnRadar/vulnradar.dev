import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const STAT_COUNT = 4;
const ROW_COUNT = 6;

function HistoryStatsSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border overflow-hidden rounded-md border border-border">
      {Array.from({ length: STAT_COUNT }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 bg-card">
          <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-8" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function HistoryScanListSkeleton() {
  return (
    <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
      {Array.from({ length: ROW_COUNT }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 pl-4 pr-4">
          <Skeleton className="h-9 w-9 rounded-md shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="hidden sm:block h-5 w-14 rounded" />
          <Skeleton className="hidden sm:block h-5 w-20 rounded-full" />
          <Skeleton className="hidden sm:block h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

/**
 * Mirrors HistoryPage's real list-view layout (title, stat grid, scan
 * rows) so the route-level loading.tsx and the client component's own
 * pre-fetch state render the same shape.
 */
export function HistorySkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5"
        role="status"
        aria-live="polite"
        aria-label="Loading scan history"
      >
        <div className="mb-1 pb-2 pt-6 sm:pt-8 space-y-2">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-48" />
        </div>

        <HistoryStatsSkeleton />
        <HistoryScanListSkeleton />
      </main>
      <Footer />
    </div>
  );
}
