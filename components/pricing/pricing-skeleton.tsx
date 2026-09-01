import { Footer } from "@/components/scanner/footer";
import { Skeleton } from "@/components/ui/skeleton";

const CARD_COUNT = 4;
const FEATURE_COUNT = 6;
const FAQ_COUNT = 5;

/**
 * Mirrors PricingPage's real layout (nav, hero + billing toggle, plan
 * cards, feature list, FAQ, CTA) for the route-level loading.tsx
 * transition.
 */
export function PricingSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="sticky top-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-50 border-b border-border/50 bg-background/80 transition-[top] duration-300">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-4 w-20 hidden sm:block" />
          <div className="hidden md:flex items-center gap-6 ml-2">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-8 w-24 rounded ml-auto" />
        </div>
      </div>
      <div
        className="h-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] transition-[height] duration-300"
        aria-hidden="true"
      />

      <main
        className="flex-1"
        role="status"
        aria-live="polite"
        aria-label="Loading pricing"
      >
        <section className="border-b border-border/50">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-10 sm:pt-20 sm:pb-12">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-8 lg:gap-12 lg:items-end">
              <div className="max-w-2xl space-y-4">
                <Skeleton className="h-10 w-full max-w-md" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <Skeleton className="h-11 w-48 rounded-lg" />
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: CARD_COUNT }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col rounded-xl border border-border/50 bg-card/50 p-5 lg:p-6 gap-3"
              >
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-16 mt-2" />
                <Skeleton className="h-9 w-full rounded-md mt-3" />
                <div className="mt-3 space-y-2">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Skeleton key={j} className="h-3 w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-3">
          {Array.from({ length: FEATURE_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full max-w-xl" />
          ))}
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16 space-y-3">
          {Array.from({ length: FAQ_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </section>
      </main>

      <Footer />
    </div>
  );
}
