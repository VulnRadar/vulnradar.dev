import { Skeleton } from "@/components/ui/skeleton";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { SkeletonRegion } from "@/components/shared/skeleton-shapes";

const TAB_COUNT = 8;

// How the desktop sidebar is grouped (Account 4, Build with it 2,
// Preferences 2). Kept here so the placeholder has the same rhythm as the
// real nav and the sidebar does not reflow when it swaps in.
const TAB_GROUP_SIZES = [4, 2, 2];

/**
 * The settings panel only. The title and the tab sidebar next to it need no
 * data, so ProfileContent renders both for real from its first frame and swaps
 * only this column: the tab you clicked stays clickable while the account
 * loads, instead of the whole page turning grey and then rebuilding itself.
 *
 * Shaped as the General tab, which is where /profile lands unless ?tab= says
 * otherwise: two titled sections in a gap-8 column, each a heading over a
 * card, rather than the three bare rectangles at gap-4 that used to stand here
 * and matched no tab on the page. Eight tabs share this one slot so no set of
 * numbers can be right for all of them, but every tab is built from this same
 * heading-over-card rhythm, so the shape is honest even where the height is
 * only close.
 */
export function ProfileDataSkeleton() {
  return (
    <SkeletonRegion label="Loading your account settings" className="gap-8">
      <div>
        <div className="mb-4 space-y-1.5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        {/* Avatar row, name and email: the tallest card on the tab. */}
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
      <div>
        <div className="mb-4 space-y-1.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </SkeletonRegion>
  );
}

/**
 * The same panel inside the app chrome, for app/profile/loading.tsx, which
 * runs before ProfileContent exists. The title and sidebar are placeholders
 * here for that reason and only that reason: nothing has mounted yet to draw
 * them for real.
 *
 * lg:px-8 rather than the shell default alone: /profile is the one app page
 * that widens its gutter at lg, and the two must not disagree.
 */
export function ProfileSkeleton() {
  return (
    <AppPageShell
      maxWidth="max-w-5xl"
      padding="py-8 sm:py-10"
      className="lg:px-8 flex flex-col gap-6 sm:gap-8"
    >
      <div className="mb-2 space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        {/* Sidebar */}
        {/* Both strips are measured off the real nav rather than eyeballed,
            which is what the old copy got wrong in both directions: the mobile
            chips were h-8 against buttons that are px-3.5 py-3 (44px) and had
            a pb-3 the real strip does not have, and the desktop entries were
            h-9 at gap-1.5 against px-3 py-2.5 links (40px) at gap-0.5. Across
            eight entries that added up to a sidebar of the wrong height under
            a page claiming it would not move. */}
        <aside className="lg:w-48 lg:shrink-0">
          <div className="lg:hidden overflow-x-auto -mx-4 px-4 border-b border-border/80">
            <div className="flex gap-0.5 min-w-max">
              {Array.from({ length: TAB_COUNT }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-24 rounded-md shrink-0" />
              ))}
            </div>
          </div>
          <div className="hidden lg:flex flex-col gap-5">
            {TAB_GROUP_SIZES.map((size, g) => (
              <div key={g} className="flex flex-col gap-0.5">
                <Skeleton className="h-4 w-20 ml-3 mb-1 rounded-md" />
                {Array.from({ length: size }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <ProfileDataSkeleton />
        </div>
      </div>
    </AppPageShell>
  );
}
