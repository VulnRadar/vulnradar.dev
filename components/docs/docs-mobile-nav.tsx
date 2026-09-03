"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import { modalCloseChip } from "@/components/ui/modal-grammar";
import { List, X } from "lucide-react";
import { DOCS_NAV, isNavItemActive } from "./docs-nav";
import type { TocItem } from "./docs-types";

interface DocsMobileNavProps {
  tocItems: TocItem[];
  activeSection: string;
  isOpen: boolean;
  onClose: () => void;
}

export function DocsMobileNavTrigger({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    // Below lg this button is the only route to the docs sidebar and the
    // on-page table of contents, and it sat in the 80-120px band the cookie
    // notice covers on a phone. Offset above whatever height that bar is
    // currently reporting (0px when it is dismissed or absent).
    <div className="lg:hidden fixed right-4 bottom-[calc(5rem+var(--vr-cookie-h,0px))] z-50">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="docs-mobile-nav"
        className={cn(
          "flex items-center gap-2 rounded-full bg-primary px-3.5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg",
          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <List className="h-4 w-4" aria-hidden="true" />
        <span>Contents</span>
      </button>
    </div>
  );
}

export function DocsMobileNav({
  tocItems,
  activeSection,
  isOpen,
  onClose,
}: DocsMobileNavProps) {
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Escape closes the drawer, and focus moves into it on open so a keyboard
  // user is not left tabbing through the page behind it.
  //
  // The drawer declares aria-modal="true", so Tab has to stay inside it: it
  // used to walk straight out into the fully focusable page behind, which
  // tells a screen-reader user the content behind is inert when it is not.
  // The page also scroll-chained at the drawer's ends, so reaching the bottom
  // of the nav started scrolling the article underneath.
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      id="docs-mobile-nav"
      role="dialog"
      aria-modal="true"
      aria-label="Documentation navigation"
      className="lg:hidden fixed inset-0 z-40 bg-background/95 backdrop-blur-xs"
    >
      {/* The close button used to be absolutely positioned inside the
          scrolling element itself, so on a drawer holding 20 nav links plus
          the page TOC (easily 1200px against a 667px phone) it scrolled out of
          reach on the first swipe. It is a direct child of the fixed shell
          now, and only the content below it scrolls. */}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close navigation"
        className={cn(modalCloseChip, "right-3 top-3 z-10")}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className="h-full overflow-y-auto overscroll-contain px-4 pb-24 pt-16 sm:px-6">
        <nav aria-label="Documentation" className="space-y-6">
          {DOCS_NAV.map((section) => (
            <div key={section.title}>
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
                          "block rounded-lg px-3 py-2.5 transition-colors",
                          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        <span className="block text-sm font-medium">
                          {item.label}
                        </span>
                        {item.summary && (
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

        {tocItems.length > 0 && (
          <div className="mt-8 border-t border-border pt-6">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              On this page
            </h2>
            <nav aria-label="On this page" className="space-y-0.5">
              {tocItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  onClick={onClose}
                  aria-current={activeSection === item.id ? "true" : undefined}
                  className={cn(
                    // min-h-11 (44px): this is a touch-only surface, so the
                    // on-this-page links were the one place in the mobile
                    // nav still under the minimum target size.
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
          </div>
        )}
      </div>
    </div>
  );
}
