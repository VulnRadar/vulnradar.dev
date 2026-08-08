import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSkeleton as ScanDashboardSkeleton } from "@/components/scanner/dashboard";

const CONTAINER = "w-full max-w-6xl mx-auto px-4 sm:px-6";
const MODE_TAB_COUNT = 3;

/**
 * Mirrors DashboardContent's idle-state layout (hero, scan form, recent
 * activity) so the route-level loading.tsx and the Suspense fallback used
 * while useSearchParams resolves render the same shape as the real page.
 * The recent-activity portion reuses ScanDashboardSkeleton, the same
 * skeleton the Dashboard panel itself shows while it fetches its own
 * data, so nothing reflows once that panel mounts.
 */
export function DashboardRouteSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className={`flex-1 pb-16 ${CONTAINER}`}
        role="status"
        aria-live="polite"
        aria-label="Loading scanner"
      >
        <div className="pt-8 pb-5 sm:pt-10 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-2 py-1.5">
            {Array.from({ length: MODE_TAB_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded" />
            ))}
          </div>
          <div className="flex flex-col gap-2 p-2 sm:flex-row sm:p-2.5">
            <Skeleton className="h-11 flex-1 rounded-md" />
            <Skeleton className="h-11 w-24 rounded-md shrink-0" />
          </div>
        </div>

        <ScanDashboardSkeleton />
      </main>
      <Footer />
    </div>
  );
}
