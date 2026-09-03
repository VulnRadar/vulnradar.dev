import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { CheckoutShell } from "./checkout-shell";
import { PaymentFormSkeleton } from "./checkout-status";

/**
 * The route-transition placeholder for app/checkout/[productId].
 *
 * It is the only thing left under /checkout that this stands in for: the three
 * credit top-ups that used to share it moved to /ai-credits, /github-credits
 * and /browser-credits, and they have their own skeleton (credits-skeleton.tsx)
 * because their first screen is a single-column list of prices, not a payment
 * form. This one was drawing an order summary and a card form for those pages
 * too, so on three of the four checkout routes it promised a layout that never
 * arrived, then reflowed into a different one.
 *
 * Only app/checkout/loading.tsx renders this now, and only because the page
 * module has not been fetched yet at that point. Once CheckoutPage is mounted
 * it draws the heading and the whole order summary immediately (both are read
 * synchronously out of PRODUCTS and PLANS, and never needed a placeholder),
 * and PaymentFormSkeleton below stands in for the payment column alone.
 *
 * The payment half is the real PaymentFormSkeleton the Stripe form itself
 * shows before it mounts, not a second hand-drawn guess at the same thing.
 */
export function CheckoutSkeleton() {
  return (
    <CheckoutShell>
      <SkeletonRegion
        label="Loading checkout"
        className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-x-12 md:items-start"
      >
        {/* The heading is its own full-width grid row on the real page, so
            it is one here too rather than a block above the grid. */}
        <div className="md:col-span-2 space-y-5">
          <Skeleton className="h-9 sm:h-10 w-3/4 max-w-md" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </div>

        <div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-px w-full" />
            <div className="flex justify-between items-center">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3.5 w-20" />
            </div>
            <Skeleton className="h-px w-full" />
            <div className="flex justify-between items-start">
              <Skeleton className="h-5 w-24" />
              <div className="space-y-1.5 text-right">
                <Skeleton className="h-8 w-20 ml-auto" />
                <Skeleton className="h-3 w-24 ml-auto" />
              </div>
            </div>
            <Skeleton className="h-3 w-full" />
          </div>

          {/* The included-features list is a plain list on the page, not a
              second bordered card, so the skeleton draws no panel and no
              icon column that will not be there. */}
          <div className="mt-6 space-y-3">
            <Skeleton className="h-4 w-28" />
            {/* Five bullets, ragged, because five real feature sentences
                are ragged. Written out rather than interpolated so Tailwind
                still sees every class it has to generate. */}
            <Skeleton className="h-3.5 w-full max-w-sm" />
            <Skeleton className="h-3.5 w-4/5 max-w-sm" />
            <Skeleton className="h-3.5 w-11/12 max-w-sm" />
            <Skeleton className="h-3.5 w-3/5 max-w-sm" />
            <Skeleton className="h-3.5 w-2/3 max-w-sm" />
          </div>

          <Skeleton className="h-3 w-64 mt-6" />
        </div>

        <div>
          <div className="rounded-xl border border-border bg-card p-6 space-y-5">
            <Skeleton className="h-5 w-32" />
            <PaymentFormSkeleton />
          </div>
          <div className="mt-4 space-y-1.5">
            <Skeleton className="h-3 w-3/4 mx-auto" />
            <Skeleton className="h-3 w-1/2 mx-auto" />
          </div>
        </div>
      </SkeletonRegion>
    </CheckoutShell>
  );
}
