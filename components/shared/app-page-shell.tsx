import type { ReactNode } from "react";
import { Header } from "@/components/scanner/header";
import { Footer } from "@/components/scanner/footer";
import { cn } from "@/lib/ui/utils";

/**
 * The one chrome for every signed-in app page, and the missing half of the
 * pair whose public side is PublicPageShell.
 *
 * Its absence is what made skeletons drift. Eleven pages open with the same
 * four things (the min-h-screen column, Header, a measured main, Footer) and
 * eleven *skeleton* files hand-copied those same four things a second time, so
 * every page shipped two independently maintained descriptions of its own
 * chrome. Nothing kept them equal. /assets is the proof: the page renders a
 * HistoryViewTabs strip that its skeleton had never heard of, so the tab bar
 * popped into existence on load and shoved the content down.
 *
 * The fix is not a better skeleton, it is noticing that chrome does not need
 * data. Header, the container and Footer can render on the first frame every
 * time. So a page keeps its shell mounted and swaps only the region that is
 * actually waiting:
 *
 *     <AppPageShell maxWidth="max-w-6xl">
 *       <PageTitle />              // real, immediately
 *       <HistoryViewTabs />        // real, immediately
 *       {loading ? <AssetsDataSkeleton /> : <AssetsTable ... />}
 *     </AppPageShell>
 *
 * rather than the old `if (loading) return <WholePageSkeleton />`, which threw
 * away a navigation bar it already had in order to draw grey boxes where it
 * used to be. Chrome drift is then impossible by construction rather than by
 * vigilance, which is the only reason the old arrangement ever worked.
 */
interface AppPageShellProps {
  children: ReactNode;
  /** Max-width class for the main content area. Defaults to "max-w-6xl". */
  maxWidth?: string;
  /** Padding class for main. Defaults to "py-6 sm:py-8". */
  padding?: string;
  /** Extra classes on main, e.g. "flex flex-col gap-5". */
  className?: string;
  /**
   * For a page built of full-bleed sections that carry their own containers.
   * `maxWidth` and `padding` are ignored, matching PublicPageShell.
   */
  fullBleed?: boolean;
}

export function AppPageShell({
  children,
  maxWidth = "max-w-6xl",
  padding = "py-6 sm:py-8",
  className,
  fullBleed = false,
}: AppPageShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main
        id="main-content"
        // tabIndex={-1} is what actually makes the layout's skip link work:
        // without it the browser scrolls to <main> but leaves focus on the
        // link, so the next Tab walks back into the nav the user just skipped.
        tabIndex={-1}
        className={cn(
          "flex-1 w-full min-w-0",
          fullBleed ? undefined : `${maxWidth} mx-auto px-4 sm:px-6 ${padding}`,
          className,
        )}
      >
        {children}
      </main>

      <Footer />
    </div>
  );
}
