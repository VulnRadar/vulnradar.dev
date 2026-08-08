import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const STAT_COUNT = 4;
const ROW_COUNT = 6;

function SharesStatsSkeleton() {
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

function SharesTableSkeleton() {
  return (
    <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
      {Array.from({ length: ROW_COUNT }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3.5 pl-4 pr-4">
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="hidden sm:block h-4 w-20" />
          <Skeleton className="hidden sm:block h-4 w-16" />
          <Skeleton className="hidden sm:block h-4 w-14" />
          <Skeleton className="h-8 w-8 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Mirrors SharesPage's real layout (title, stat grid, share rows) so the
 * route-level loading.tsx and the client component's own pre-fetch state
 * render the same shape.
 */
export function SharesSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="w-full max-w-6xl mx-auto flex-1 px-4 py-6 sm:px-6 sm:py-8"
        role="status"
        aria-live="polite"
        aria-label="Loading shared reports"
      >
        <div className="flex flex-col gap-5">
          <div className="pb-2 pt-2 sm:pt-4 space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full max-w-md" />
          </div>
          <SharesStatsSkeleton />
          <SharesTableSkeleton />
        </div>
      </main>
      <Footer />
    </div>
  );
}
