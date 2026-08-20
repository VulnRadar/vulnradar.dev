"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { DocsSidebar } from "./docs-sidebar";
import { DocsToc } from "./docs-toc";
import { DocsMobileNavTrigger, DocsMobileNav } from "./docs-mobile-nav";
import { DocsBreadcrumb, DocsPager } from "./docs-pager";
import type { TocItem } from "./docs-types";

// This shell used to be app/docs/layout.tsx. It moved here so the layout can
// be a server component and export per-page metadata, which a "use client"
// layout cannot do. Docs pages are the pages most worth ranking, so they need
// titles, descriptions, and canonical URLs.
//
// Pages import useDocsContext from this module rather than from the layout
// file, which is also the right home for a hook.

interface DocsContextType {
  activeSection: string;
  setActiveSection: (section: string) => void;
  tocItems: TocItem[];
  setTocItems: (items: TocItem[]) => void;
}

const DocsContext = createContext<DocsContextType>({
  activeSection: "",
  setActiveSection: () => {},
  tocItems: [],
  setTocItems: () => {},
});

export function useDocsContext() {
  return useContext(DocsContext);
}

export type { TocItem };

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [activeSection, setActiveSection] = useState("");
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile nav on route change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets mobileNavOpen when pathname changes (route navigation), gated on the dependency array so it only fires on an actual route change, not every render
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <DocsContext.Provider
      value={{ activeSection, setActiveSection, tocItems, setTocItems }}
    >
      <div className="min-h-screen flex flex-col bg-background">
        <LandingNav />

        <div className="flex-1 max-w-360 w-full mx-auto">
          <div className="flex">
            <DocsSidebar />

            <DocsMobileNavTrigger
              isOpen={mobileNavOpen}
              onToggle={() => setMobileNavOpen(!mobileNavOpen)}
            />

            <DocsMobileNav
              tocItems={tocItems}
              activeSection={activeSection}
              isOpen={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
            />

            <main
              id="docs-content"
              className="flex-1 min-w-0 px-4 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10"
            >
              <article className="max-w-4xl mx-auto lg:mx-0">
                <DocsBreadcrumb />
                {children}
                <DocsPager />
              </article>
            </main>

            <DocsToc items={tocItems} activeSection={activeSection} />
          </div>
        </div>

        <Footer />
      </div>
    </DocsContext.Provider>
  );
}
