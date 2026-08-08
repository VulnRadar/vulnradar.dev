import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_COUNT = 5;

/**
 * Mirrors TeamsList's real layout (title, search + create row, team
 * table) so the route-level loading.tsx and the client component's own
 * pre-fetch state render the same shape.
 */
export function TeamsSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6"
        role="status"
        aria-live="polite"
        aria-label="Loading teams"
      >
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-64" />
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Skeleton className="h-10 flex-1 rounded-md" />
          <Skeleton className="h-10 w-32 rounded-md shrink-0" />
        </div>

        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="hidden sm:block h-10 bg-muted/30 border-b border-border" />
          <div className="divide-y divide-border">
            {Array.from({ length: ROW_COUNT }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-20 sm:hidden" />
                </div>
                <Skeleton className="hidden sm:block h-4 w-6" />
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-4 rounded-full shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
