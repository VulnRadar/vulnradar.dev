import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

const ROW_COUNT = 5;

/**
 * Two exports over one shape, because a skeleton has two callers that want
 * opposite things.
 *
 * app/teams/loading.tsx renders before the page component exists, so it needs
 * the whole chrome. The page's own loading branch renders while that chrome is
 * already on screen, so drawing it again would tear down a Header the user can
 * see. The old single export did the second thing in both places, and along the
 * way dropped the `id="main-content"` / `tabIndex={-1}` the layout's skip link
 * targets, so the skip link went nowhere for as long as the page was loading.
 *
 * The title block is inside the region rather than rendered for real by the
 * page, because on /teams it belongs to TeamsList, which cannot be mounted
 * without the teams: with an empty list it renders "No teams yet", which is a
 * claim about the account rather than a placeholder.
 *
 * gap-6, not the region default: that is TeamsList's own internal gap.
 */
export function TeamsDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your teams" className="gap-6">
      {/* Title and the New team button share a row, and the list is rows of
          team picture + name + meta + role pill. The old shape here still drew
          the column-header band and the search field that the list no longer
          renders until there is something to search. The circle is the team's
          picture, falling back to the owner's face and then to an initial
          (components/teams/team-avatar.tsx), so its size is the same either way
          and this shape holds. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-7 w-24 sm:h-8" />
          <Skeleton className="h-5 w-full max-w-2xl" />
        </div>
        <Skeleton className="h-10 w-32 shrink-0" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="divide-y divide-border">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3.5 sm:px-5"
            >
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full shrink-0" />
              <Skeleton className="h-4 w-4 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function TeamsSkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      <TeamsDataSkeleton />
    </AppPageShell>
  );
}
