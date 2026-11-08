"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import { modalCloseChip } from "@/components/ui/modal-grammar";
import { useInertBackground } from "@/lib/hooks/use-modal-a11y";
import { X } from "lucide-react";
import { DOCS_NAV, docsPageContext, isNavItemActive } from "./docs-nav";
import { DocsSearchButton } from "./docs-search";
import {
  DocsTabStrip,
  panelDomId,
  tabDomId,
  type DocsTabDef,
} from "./docs-tab-strip";
import type { TocItem } from "./docs-types";

export type DocsDrawerTab = "page" | "all";

/** A page with an outline opens on it: that is why the bar got pressed. */
export function defaultDrawerTab(tocItems: TocItem[]): DocsDrawerTab {
  return tocItems.length > 0 ? "page" : "all";
}

/**
 * The bar under the site nav, in flow and sticky: search on the left, where
 * you are on the right. It replaced a floating pill that sat over the content,
 * and it stays until the right rail exists at xl so a laptop-width reader
 * still has the outline. Search is also in the sidebar from lg.
 */
export function DocsMobileBar({
  tocItems,
  activeSection,
  isOpen,
  onOpen,
}: {
  tocItems: TocItem[];
  activeSection: string;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const pathname = usePathname();
  const { current } = docsPageContext(pathname);
  const section =
    tocItems.find((item) => item.id === activeSection) ?? tocItems[0];

  return (
    <div
      className={cn(
        "sticky top-[calc(3.5rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-30 h-11 -mx-4 -mt-6 mb-6 flex items-stretch justify-between gap-3 border-b border-border/50 bg-background/95 px-4 backdrop-blur-xs transition-[top] duration-300 sm:-mx-6 sm:-mt-8 sm:px-6 lg:-mx-10 lg:-mt-10 lg:mb-10 lg:px-10",
        tocItems.length > 0 ? "xl:hidden" : "lg:hidden",
      )}
    >
      <DocsSearchButton compact className="shrink-0 lg:invisible" />
      <button
        type="button"
        onClick={onOpen}
        aria-expanded={isOpen}
        aria-controls="docs-mobile-nav"
        className="min-w-0 truncate text-right text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {section
          ? `On this page: ${section.label}`
          : (current?.label ?? "All docs")}
      </button>
    </div>
  );
}

interface DocsMobileNavProps {
  tocItems: TocItem[];
  activeSection: string;
  /** Which tab to open on; null while the drawer is closed. */
  openTab: DocsDrawerTab | null;
  onClose: () => void;
}

/** Mounted only while open, so every opening starts on its default tab. */
export function DocsMobileNav({ openTab, ...rest }: DocsMobileNavProps) {
  if (openTab === null) return null;
  return <DocsDrawer initialTab={openTab} {...rest} />;
}

const DRAWER_TABS: (DocsTabDef & { id: DocsDrawerTab })[] = [
  { id: "page", label: "This page" },
  { id: "all", label: "All docs" },
];

function DocsDrawer({
  tocItems,
  activeSection,
  initialTab,
  onClose,
}: Omit<DocsMobileNavProps, "openTab"> & { initialTab: DocsDrawerTab }) {
  const pathname = usePathname();
  const { section: currentSection } = docsPageContext(pathname);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<DocsDrawerTab>(initialTab);
  const baseId = useId().replace(/:/g, "");
  const tabs = tocItems.length > 0 ? DRAWER_TABS : [DRAWER_TABS[1]];

  // This drawer declares aria-modal="true", which promises the page behind it
  // is inert. Shared with every modal in the product rather than written a
  // third time.
  useInertBackground(true, panelRef);

  // Escape closes the drawer, and focus moves into it on open so a keyboard
  // user is not left tabbing through the page behind it.
  //
  // The drawer declares aria-modal="true", so Tab has to stay inside it: it
  // used to walk straight out into the fully focusable page behind, which
  // tells a screen-reader user the content behind is inert when it is not.
  // The page also scroll-chained at the drawer's ends, so reaching the bottom
  // of the nav started scrolling the article underneath.
  useEffect(() => {
    // a11y (SC 2.4.3): remember where focus came from. Closing with Escape or
    // the X used to drop focus to <body>, so the next Tab restarted at the
    // top of the document rather than at the trigger the user opened this
    // from, halfway down a docs page.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !panel.contains(active))
      ) {
        // The `!panel.contains(active)` half was only on the Shift+Tab branch.
        // If focus ever landed outside the drawer (an async re-render between
        // open and the first Tab), forward Tab had no way to pull it back.
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  // Centre the current link, in the drawer's own scroller. A long list opened
  // at its top put the page you are on a full screen below the fold.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const link = scroller?.querySelector<HTMLElement>("[aria-current]");
    if (scroller && link) {
      scroller.scrollTop =
        link.offsetTop - scroller.clientHeight / 2 + link.offsetHeight / 2;
    }
  }, [tab]);

  return (
    <div
      ref={panelRef}
      id="docs-mobile-nav"
      role="dialog"
      aria-modal="true"
      aria-label="Documentation navigation"
      // Hangs off the bottom of the public nav instead of covering the whole
      // viewport. The nav is sticky at z-50 and the drawer is z-40, so with
      // inset-0 the nav painted over the drawer's top 56px, which is exactly
      // where the close chip sits: the X was invisible, a tap on it opened the
      // nav's own menu, and focus moved to it on open landed on a control
      // behind a blurred bar (SC 2.4.11). 3.5rem is the nav's h-14; the two
      // variables are the same banner heights the nav adds to its own `top`
      // (site-notifications.tsx and admin/impersonation-banner.tsx), so the
      // drawer follows it down when either banner is up.
      className="xl:hidden fixed inset-x-0 bottom-0 top-[calc(3.5rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] z-40 flex flex-col bg-background/95 backdrop-blur-xs transition-[top] duration-300"
    >
      {/* A direct child of the fixed shell, so it does not scroll away with
          the links. */}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close navigation"
        className={cn(modalCloseChip, "right-3 top-3 z-10")}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* pr-14 keeps the tabs clear of the close chip in the same corner. */}
      <div className="shrink-0 pl-4 pr-14 pt-2 sm:pl-6">
        <DocsTabStrip
          tabs={tabs}
          active={tab}
          onSelect={(id) => setTab(id as DocsDrawerTab)}
          baseId={baseId}
          label="Documentation navigation"
        />
      </div>

      <div
        ref={scrollerRef}
        role="tabpanel"
        id={panelDomId(baseId, tab)}
        aria-labelledby={tabDomId(baseId, tab)}
        // pb reads --vr-cookie-h: the notice is fixed to this same bottom edge
        // and would otherwise cover the last links.
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1.5rem+var(--vr-cookie-h,0px))] sm:px-6"
      >
        {tab === "page" ? (
          <nav aria-label="On this page" className="space-y-0.5">
            {tocItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={onClose}
                aria-current={activeSection === item.id ? "true" : undefined}
                className={cn(
                  // min-h-11 (44px): this is a touch-only surface.
                  "flex min-h-11 items-center rounded-md px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  item.level === 2 && "pl-6",
                  activeSection === item.id
                    ? "bg-primary/5 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
        ) : (
          <nav aria-label="Documentation" className="space-y-6">
            {DOCS_NAV.map((section) => (
              <div key={section.id}>
                <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {section.title}
                </h2>
                <ul className="space-y-1">
                  {section.items.map((item) => {
                    const isActive = isNavItemActive(item, pathname);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          aria-current={isActive ? "page" : undefined}
                          className={cn(
                            "flex min-h-11 flex-col justify-center rounded-lg px-3 py-1.5 transition-colors",
                            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted",
                          )}
                        >
                          <span className="block text-sm font-medium">
                            {item.label}
                          </span>
                          {/* Only the group you are in: twenty-four summaries
                              were most of why the list ran 1,700px. */}
                          {section.id === currentSection?.id && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {item.summary}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
