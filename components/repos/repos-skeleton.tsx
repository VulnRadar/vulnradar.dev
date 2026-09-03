import { Skeleton } from "@/components/ui/skeleton";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";

const ROW_COUNT = 5;

/** Mirrors app/repos/page.tsx's list view so the initial status + repo fetch
 *  doesn't reflow the page once it resolves. Every measurement here is taken
 *  from that page's real controls rather than eyeballed: Input is h-10
 *  rounded-md, Button size="sm" is h-9 rounded-md, the list panel is
 *  rounded-xl with divide-border/60 (rounded-lg here was a rung below its own
 *  content), and the search field lives in the list's space-y-3 wrapper
 *  rather than the main's gap-5, which alone moved the whole list 8px on load.
 *
 *  The page's title block is NOT here: it needs no data, so the page renders
 *  it for real and only this region waits. `gap-0` because the space-y-3
 *  wrapper below owns the spacing. */
export function ReposDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your repositories" className="gap-0">
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              {/* The "updated Mon D" column, hidden at the same breakpoint
                  the real one is. */}
              <Skeleton className="hidden sm:block h-3 w-20 shrink-0" />
              <Skeleton className="h-9 w-24 rounded-md shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** The same region inside the app chrome, for app/repos/loading.tsx. That
 *  runs before the page component exists, so the title block it renders for
 *  real is a placeholder here. */
export function ReposSkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 flex-wrap pt-2">
        <div className="space-y-1.5">
          <Skeleton className="h-7 sm:h-8 w-28" />
          {/* Two lines: the real description wraps inside max-w-prose. */}
          <Skeleton className="h-4 w-[30rem] max-w-full" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        {/* The "Edit selection" button, which the list view renders and this
            skeleton left out entirely. */}
        <Skeleton className="h-9 w-32 rounded-md shrink-0" />
      </div>
      <ReposDataSkeleton />
    </AppPageShell>
  );
}
