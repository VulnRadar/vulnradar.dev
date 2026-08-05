"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Code2,
  Webhook,
  Gauge,
  Cpu,
  Server,
  Settings,
} from "lucide-react";
import { Footer } from "@/components/scanner/footer";
import { LandingNav } from "@/components/landing/landing-nav";
import {
  DocsSidebar,
  DocsToc,
  DocsMobileNavTrigger,
  DocsMobileNav,
  type TocItem,
  type NavItem,
} from "@/components/docs";

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

const mainNavItems: NavItem[] = [
  { href: "/docs", label: "Getting Started", icon: BookOpen, exact: true },
  { href: "/docs/setup", label: "Setup Guide", icon: BookOpen },
  { href: "/docs/self-hosting", label: "Self-Hosting", icon: Server },
  { href: "/docs/config", label: "Configuration", icon: Settings },
  { href: "/docs/architecture", label: "Architecture", icon: Cpu },
  { href: "/docs/api", label: "API Reference", icon: Code2 },
  { href: "/docs/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/docs/rate-limits", label: "Rate Limits", icon: Gauge },
  { href: "/docs/developers", label: "Developers", icon: Code2 },
];

export function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [activeSection, setActiveSection] = useState("");
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close mobile nav on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <DocsContext.Provider
      value={{ activeSection, setActiveSection, tocItems, setTocItems }}
    >
      <div className="min-h-screen flex flex-col bg-background">
        <LandingNav />

        <div className="flex-1 max-w-[90rem] w-full mx-auto">
          <div className="flex">
            <DocsSidebar navItems={mainNavItems} />

            <DocsMobileNavTrigger
              onToggle={() => setMobileNavOpen(!mobileNavOpen)}
            />

            <DocsMobileNav
              navItems={mainNavItems}
              tocItems={tocItems}
              activeSection={activeSection}
              isOpen={mobileNavOpen}
              onToggle={() => setMobileNavOpen(!mobileNavOpen)}
              onClose={() => setMobileNavOpen(false)}
            />

            {/* Main Content */}
            <main className="flex-1 min-w-0 px-3 sm:px-6 lg:px-10 py-6 sm:py-8 lg:py-10">
              <article className="max-w-4xl mx-auto lg:mx-0">
                {children}
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
