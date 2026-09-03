import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthCardSkeleton } from "@/components/admin/shared";
import { ADMIN_NAV_GROUPS } from "@/components/admin/nav";

/**
 * Two exports over one shape, because a skeleton has two callers that want
 * opposite things.
 *
 * app/admin/loading.tsx renders before AdminContent exists, so it needs the
 * whole chrome. AdminContent's own pre-fetch state renders while that chrome
 * is already on screen, so drawing it again would tear down a Header the
 * operator can see. AdminSkeleton is the shell version, AdminDataSkeleton is
 * the region, and the shape below them is written once.
 *
 * What waits here is the sidebar and the panel. The sidebar is filtered by
 * callerRole, which arrives with the admin data request, and the panel is the
 * System Health card the tab lands on. The title block is not waiting on
 * anything, so it is real text on the first frame in both callers.
 *
 * The body used to be two stat bars over an eight-row user table. That was
 * the shape of the old landing tab: Overview has been the landing tab since
 * AUDIT-014#qols-02, so the skeleton drew counters and a table, then a status
 * list arrived in their place. The width was stale for the same reason,
 * max-w-7xl against the page's max-w-6xl, so the content edge jumped too.
 */
export function AdminDataSkeleton() {
  return (
    <SkeletonRegion label="Loading admin panel" className="lg:flex-row gap-6">
      <aside className="w-full min-w-0 lg:w-52 shrink-0">
        {/* The phone layout opens with a section-picker button, which the
            placeholder left out entirely, so on mobile the health card sat
            where the button lands and everything shifted down by its height
            once the panel hydrated. */}
        <div className="lg:hidden mb-4 h-[42px] rounded-lg border border-border bg-card animate-pulse motion-reduce:animate-none" />

        {/* Group and item counts come from ADMIN_NAV_GROUPS, not from a
            hand-typed list. The hand-typed one said four groups of
            [6, 4, 2, 4]; the table has had seven groups and 21 items for a
            while, so the sidebar grew by three whole groups the moment the
            role resolved. Permissions can only ever remove items from this,
            so the full table is the right shape to reserve. */}
        <div className="hidden lg:flex flex-col gap-5">
          {ADMIN_NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <Skeleton className="h-2.5 w-16 mb-1.5 ml-2" />
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <Skeleton
                    key={item.key}
                    className="h-9 rounded-lg bg-muted/60"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Overview: the System Health card, header over a status list */}
      <div className="flex-1 min-w-0 flex flex-col gap-6">
        <HealthCardSkeleton />
      </div>
    </SkeletonRegion>
  );
}

export function AdminSkeleton() {
  return (
    <AppPageShell padding="py-8">
      {/* Real text, not bars: this heading and subtitle are constants in
          AdminContent, so there is nothing here for a placeholder to stand
          in for. */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          Admin Panel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every section here is filtered to what your role can act on.
        </p>
      </div>

      <AdminDataSkeleton />
    </AppPageShell>
  );
}
