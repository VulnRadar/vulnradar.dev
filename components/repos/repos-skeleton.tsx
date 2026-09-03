import { Skeleton } from "@/components/ui/skeleton";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";

const ROW_COUNT = 5;

/** The five-track layout ReposList's header band and every row key off. */
const GRID = "sm:grid-cols-[1rem_minmax(0,1fr)_10.5rem_5.5rem_auto]";

/** Mirrors app/repos/page.tsx's list view so the initial status + repo fetch
 *  doesn't reflow the page once it resolves. Every measurement here is taken
 *  from that page's real controls rather than eyeballed: the search field is
 *  h-10 rounded-md, the filter triggers h-11 stepping down to h-10, the Scan
 *  button h-11 stepping down to h-9, and the list panel is rounded-xl with a
 *  column header band above divide-border rows.
 *
 *  The page's title block is NOT here: it needs no data, so the page renders
 *  it for real and only this region waits. */
export function ReposDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your repositories">
      {/* The page opens with the same four-cell strip /history does. Left out
          here, the whole list jumped down ~74px the moment the repos landed. */}
      <StatStripSkeleton cells={4} />

      {/* The search field only. It is unconditional on the loaded page, so it
          is the one control here that is always right.

          The status and sort triggers used to be drawn beside it, and they are
          conditional: they appear only once the account has more than
          LIST_FILTER_MIN_ITEMS repositories. Drawing them meant an account
          with three repos watched two controls fade in and then never arrive,
          which is the drift this skeleton exists to avoid. A row that is
          slightly narrower than the loaded one is a smaller lie than a row
          containing things that do not exist. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Skeleton className="h-10 min-w-[12rem] flex-1 rounded-md" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* The desktop column-header band. Without it every row sat ~37px too
            high until the list arrived. */}
        <div
          className={`hidden gap-4 border-b border-border bg-muted/30 px-4 py-2.5 sm:grid ${GRID}`}
        >
          <span aria-hidden />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-14 justify-self-end" />
          <Skeleton className="h-3.5 w-14 justify-self-end" />
        </div>

        <div className="divide-y divide-border">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              // border-l-2 is the severity rail the loaded row carries, drawn
              // transparent so the content keeps the same 2px inset.
              className={`flex items-center gap-3 border-l-2 border-transparent py-3 pl-4 pr-4 sm:grid sm:items-center sm:gap-4 ${GRID}`}
            >
              <Skeleton className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="hidden h-4 w-28 sm:block" />
              <Skeleton className="hidden h-3 w-12 sm:block sm:justify-self-end" />
              <Skeleton className="h-11 w-24 shrink-0 rounded-md sm:h-9 sm:justify-self-end" />
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
