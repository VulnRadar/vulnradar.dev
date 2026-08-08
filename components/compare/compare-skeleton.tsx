import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const HOST_ROW_COUNT = 4;

/**
 * Mirrors ComparePage's real layout (title, host search, host picker
 * list) for the route-level loading.tsx transition.
 */
export function CompareSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10"
        role="status"
        aria-live="polite"
        aria-label="Loading compare"
      >
        <div className="flex flex-col gap-8">
          <div className="max-w-2xl space-y-2.5">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>

          <div className="flex flex-col gap-6">
            <Skeleton className="h-10 w-full max-w-sm rounded-md" />
            <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden divide-y divide-border/50">
              {Array.from({ length: HOST_ROW_COUNT }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
