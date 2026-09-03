import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading states for /credits and the three top-up pages.
 *
 * Both mirror the real page they stand in for, block for block, at the same
 * container width and the same vertical rhythm. The skeleton these replace did
 * not: it drew a two-column order summary and payment form for a page whose
 * first screen is a single-column list of prices, so it promised a shape the
 * page never had and then reflowed into a different one. A skeleton that is
 * not a picture of the page is worse than no skeleton, because it spends the
 * wait teaching the reader the wrong layout.
 *
 * The width used to be stated here as well, in a local Shell that wrote out
 * the full-viewport column, the Header, a measured main and the Footer a
 * second time. AppPageShell owns all four now, so /credits can only ever be
 * one width. `max-w-5xl` is the argument passed to it, because these two pages
 * are narrower than the app default: a single column of prices does not want
 * the six-column measure the tables use.
 *
 * Only the shell exports exist, because only loading.tsx consumes them. Both
 * pages read their balances on the server and render them on the first frame,
 * so neither has a client-side loading branch that would want the region on
 * its own.
 */

/** The row shared by both pages: the allowance track and its one-line
 *  caption, under whatever balance figure the caller draws above it. */
function BalanceBlockSkeleton() {
  return (
    <>
      <Skeleton className="h-2 w-full max-w-md rounded-full" />
      <Skeleton className="h-3 w-full max-w-xs" />
    </>
  );
}

export function CreditsHubSkeleton() {
  return (
    <AppPageShell maxWidth="max-w-5xl">
      <SkeletonRegion label="Loading credits" className="gap-8">
        <div className="max-w-2xl space-y-2">
          <Skeleton className="h-7 sm:h-8 w-28" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>

        <div className="rounded-xl border border-border bg-card divide-y divide-border">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-5 sm:p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8">
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-5 w-44" />
                  <Skeleton className="h-4 w-full max-w-lg" />
                  <div className="space-y-2 pt-1">
                    <BalanceBlockSkeleton />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 sm:w-44 sm:shrink-0 sm:flex-col sm:items-end sm:justify-start sm:gap-3">
                  <div className="space-y-1.5 sm:text-right">
                    <Skeleton className="h-8 w-28 sm:ml-auto" />
                    <Skeleton className="h-3 w-24 sm:ml-auto" />
                  </div>
                  <Skeleton className="h-11 w-32 shrink-0" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="max-w-2xl space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </SkeletonRegion>
    </AppPageShell>
  );
}

export function CreditTopUpSkeleton() {
  return (
    <AppPageShell maxWidth="max-w-5xl">
      <SkeletonRegion label="Loading credit options" className="gap-6">
        <div>
          {/* The "All credits" pill is 44px on a phone and 32px from sm up
              (components/billing/credit-topup.tsx), so the placeholder shrinks
              with it rather than reserving the touch height on desktop. */}
          <Skeleton className="h-11 sm:h-8 w-28" />
          <Skeleton className="mt-3 h-7 sm:h-8 w-40" />
          <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-44" />
          <div className="space-y-2 pt-2">
            <BalanceBlockSkeleton />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton className="h-5 w-32" />
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 p-4 sm:p-5"
              >
                <div className="min-w-0 space-y-1.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <div className="shrink-0 space-y-1.5 text-right">
                  <Skeleton className="h-6 w-14 ml-auto" />
                  <Skeleton className="h-3 w-16 ml-auto" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-full max-w-2xl" />
        </div>
      </SkeletonRegion>
    </AppPageShell>
  );
}
