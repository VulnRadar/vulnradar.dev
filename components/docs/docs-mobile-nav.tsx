"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
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
    <div className="lg:hidden fixed bottom-20 right-4 z-50">
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

  // Escape closes the drawer, and focus moves into it on open so a keyboard
  // user is not left tabbing through the page behind it.
  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      id="docs-mobile-nav"
      role="dialog"
      aria-modal="true"
      aria-label="Documentation navigation"
      className="lg:hidden fixed inset-0 z-40 overflow-y-auto bg-background/95 backdrop-blur-xs"
    >
      <div className="px-4 pb-24 pt-16 sm:px-6">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="absolute right-3 top-3 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

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
                    "block rounded-md px-3 py-2 text-sm transition-colors",
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
