"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { resolveMovedAnchor } from "@/lib/docs/moved-anchors";
import { DocsContext, ignoreTocItems, useDocsContext } from "./docs-context";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import {
  DocsMobileBar,
  DocsMobileNav,
  defaultDrawerTab,
  type DocsDrawerTab,
} from "./docs-mobile-nav";
import { docsPageContext } from "./docs-nav";
import { DocsPageFooter } from "./docs-page-footer";
import { DocsBreadcrumb, DocsPager } from "./docs-pager";
import { DocsSearch } from "./docs-search";
import type { TocItem } from "./docs-types";

// This shell used to be app/docs/layout.tsx. It moved here so the layout can
// be a server component and export per-page metadata, which a "use client"
// layout cannot do. Docs pages are the pages most worth ranking, so they need
// titles, descriptions, and canonical URLs.

export { useDocsContext };
export type { TocItem };

const NO_TOC: TocItem[] = [];

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // During render, from the registry: usePathname works in SSR, so the rail is
  // in the server's HTML and its column is there from the first paint instead
  // of appearing after hydration and shoving the article sideways.
  const tocItems = docsPageContext(pathname).current?.toc ?? NO_TOC;
  const [activeSection, setActiveSection] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DocsDrawerTab | null>(null);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerTab(null), []);

  // Close mobile nav on route change
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- closes the drawer when pathname changes (route navigation), gated on the dependency array so it only fires on an actual route change, not every render
    setDrawerTab(null);
  }, [pathname]);

  // The one place a moved section's old link is forwarded, on arrival and when
  // an in-page link changes the hash.
  useEffect(() => {
    function forward() {
      const target = resolveMovedAnchor(pathname, window.location.hash);
      if (target) router.replace(target);
    }
    forward();
    window.addEventListener("hashchange", forward);
    return () => window.removeEventListener("hashchange", forward);
  }, [pathname, router]);

  return (
    <DocsContext.Provider
      value={{
        activeSection,
        setActiveSection,
        tocItems,
        setTocItems: ignoreTocItems,
        openSearch,
      }}
    >
      <div className="min-h-screen flex flex-col bg-background">
        {/* Deliberately the plain nav, with no width override. Docs used to
            widen the nav's inner row to max-w-360 so the wordmark lined up
            with the sidebar beneath it, which made the docs top bar the one
            public bar that did not match /changelog, /pricing and /demo: the
            wordmark moved 144px on every navigation between them. Owner call,
            2026-08-31: one top bar across the whole public surface wins over
            aligning it with a single page's sidebar. max-w-6xl is also the
            container STYLE.md documents. Do not re-add the override; the
            docs sidebar and TOC below it stay exactly as they are. */}
        <LandingNav />

        <div className="flex-1 max-w-360 w-full mx-auto">
          <div className="flex">
            <DocsSidebar />

            <DocsMobileNav
              tocItems={tocItems}
              activeSection={activeSection}
              openTab={drawerTab}
              onClose={closeDrawer}
            />

            <main
              id="main-content"
              // Focusable target for the root layout's skip link; without it
              // the link scrolls but focus stays in the nav.
              tabIndex={-1}
              className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10"
            >
              <DocsMobileBar
                tocItems={tocItems}
                activeSection={activeSection}
                isOpen={drawerTab !== null}
                onOpen={() => setDrawerTab(defaultDrawerTab(tocItems))}
              />
              <article className="max-w-4xl mx-auto lg:mx-0">
                <DocsBreadcrumb />
                {children}
                <DocsPageFooter />
                <DocsPager />
              </article>
            </main>

            <DocsToc items={tocItems} activeSection={activeSection} />
          </div>
        </div>

        <Footer />
      </div>
      <DocsSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </DocsContext.Provider>
  );
}
