import { Skeleton } from "@/components/ui/skeleton";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";

/** Mirrors app/repos/page.tsx's list-view layout so the initial status +
 *  repo fetch doesn't reflow the page once it resolves. */
export function ReposSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-5"
        role="status"
        aria-live="polite"
        aria-label="Loading repos"
      >
        <div className="space-y-1.5 pt-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="rounded-lg border border-border divide-y divide-border/60 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-4 rounded-full shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-16 rounded-md shrink-0" />
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}
