import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors CheckoutPage's real two-column layout (order summary + features
 * on the left, Stripe payment form on the right) so the auth check's
 * loading state doesn't reflow into a differently-shaped page once it
 * resolves.
 */
export function CheckoutSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10">
        <div className="container max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Skeleton className="h-8 w-28 rounded-md" />
          <div className="w-4" />
        </div>
      </header>

      <main
        className="container max-w-5xl mx-auto px-4 py-8 md:py-12"
        role="status"
        aria-live="polite"
        aria-label="Loading checkout"
      >
        <div className="grid md:grid-cols-2 gap-8 md:gap-12 md:items-start">
          <div>
            <div className="text-center md:text-left mb-6 space-y-3">
              <Skeleton className="h-5 w-20 rounded-full mx-auto md:mx-0" />
              <Skeleton className="h-8 w-64 mx-auto md:mx-0" />
              <Skeleton className="h-4 w-48 mx-auto md:mx-0" />
            </div>

            <div className="rounded-xl border border-border bg-card p-5 mb-6 space-y-4">
              <Skeleton className="h-3 w-24" />
              <div className="flex items-start gap-4">
                <Skeleton className="h-12 w-12 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
              <Skeleton className="h-px w-full" />
              <div className="flex justify-between">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-px w-full" />
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-7 w-16" />
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

          <div className="md:pt-[120px]">
            <div className="rounded-xl border border-border bg-card p-6 space-y-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
