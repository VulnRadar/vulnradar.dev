import { AppPageShell } from "@/components/shared/app-page-shell";
import { StatStripSkeleton } from "@/components/shared/stat-strip";
import {
  SkeletonRows,
  SkeletonRegion,
} from "@/components/shared/skeleton-shapes";

/**
 * Two exports over one shape, because a skeleton has two callers that want
 * opposite things and conflating them is what broke this.
 *
 * app/assets/loading.tsx renders before the page component exists, so it needs
 * the whole chrome. The page's own loading branch renders while that chrome is
 * already on screen, so drawing it again would tear down a Header and a tab
 * strip the user can see in order to replace them with grey. The old single
 * export did the second thing in both places.
 *
 * So AssetsDataSkeleton is the region, AssetsSkeleton is that region inside the
 * shell, and the shape is written once. Neither can drift from the other.
 */
export function AssetsDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your hosts">
      {/* Three, not the default four: AssetsStats dropped its host-count cell
          (the h1 subtitle above already states that number), so a four-cell
          placeholder would reflow the moment the data lands. */}
      <StatStripSkeleton cells={3} />
      <SkeletonRows rows={6} trailing={[16, 20, 14]} />
    </SkeletonRegion>
  );
}

export function AssetsSkeleton() {
  return (
    <AppPageShell className="flex flex-col gap-5">
      {/* The page's title block and tab strip are static, so loading.tsx can
          draw them for real rather than as placeholders. This is the fix for
          the visible bug: the old skeleton had no tab strip at all, so the
          bar appeared on load and shoved the whole table down. */}
      <div className="pb-1 space-y-2">
        <div className="h-7 w-20 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
        <div className="h-4 w-52 animate-pulse motion-reduce:animate-none rounded-md bg-muted" />
      </div>
      <AssetsDataSkeleton />
    </AppPageShell>
  );
}
