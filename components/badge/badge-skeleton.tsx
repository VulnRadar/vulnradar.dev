import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_COUNT = 5;

/**
 * Mirrors BadgePage's real two-column layout (scan list on the left, badge
 * preview on the right) so the pre-fetch loading state renders the same
 * shape as what replaces it: BadgeScanList's rows on the left, and
 * BadgePreview's empty "pick a scan" placeholder on the right, since
 * nothing is selected yet the moment loading finishes.
 */
export function BadgeSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main
        className="flex-1 w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10"
        role="status"
        aria-live="polite"
        aria-label="Loading badge"
      >
        <header className="mb-8 max-w-xl">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Badge
          </h1>
          <p className="text-muted-foreground mt-2 leading-relaxed">
            Pick a scan and get an image that links back to the full report. The
            badge does not refresh itself: it is a snapshot of the scan you
            picked, tied to a share link.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 items-start">
          {/* Scan list */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>

            <Skeleton className="h-10 w-full rounded-lg" />

            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
              {Array.from({ length: ROW_COUNT }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1 gap-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-5 w-14 rounded-full shrink-0" />
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex flex-col gap-4">
            <Skeleton className="h-4 w-28" />
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 flex flex-col items-center justify-center gap-3 min-h-[300px]">
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
