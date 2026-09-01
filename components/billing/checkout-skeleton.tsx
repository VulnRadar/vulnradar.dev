import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the checkout pages' real layout (heading block, then order summary
 * on the left and the Stripe payment form on the right) so the auth check's
 * loading state doesn't reflow into a differently-shaped page once it
 * resolves.
 *
 * The container classes are copied from app/checkout/* deliberately. This file
 * kept the pre-standardisation `container max-w-5xl px-4 py-8 md:py-12` after
 * those pages moved to `w-full max-w-4xl px-4 sm:px-6 py-12 sm:py-16`, so the
 * skeleton sat at a different width and a different top offset than the page
 * that replaced it, which is the exact shift the skeleton exists to prevent.
 * It also still centred the heading on mobile and pushed the right column down
 * by a hardcoded md:pt-[120px]; the real pages give the heading its own
 * full-width row above the grid instead.
 */
export function CheckoutSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-10 transition-[top] duration-300">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Skeleton className="h-8 w-36 rounded-md" />
          <div className="w-4" />
        </div>
      </header>
      <div
        className="h-[calc(var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] transition-[height] duration-300"
        aria-hidden="true"
      />

      <main
        className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16"
        role="status"
        aria-live="polite"
        aria-label="Loading checkout"
      >
        <div className="mb-8 max-w-2xl space-y-5">
          <Skeleton className="h-9 sm:h-10 w-3/4" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 md:items-start">
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-3">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-px w-full" />
              <div className="flex justify-between items-center">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <Skeleton className="h-3 w-28" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
            <Skeleton className="h-3 w-48 mx-auto mt-4" />
          </div>
        </div>
      </main>
    </div>
  );
}
