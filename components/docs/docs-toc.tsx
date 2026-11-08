"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/ui/utils";
import type { TocItem } from "./docs-types";

/** The element DocsRelated portals into, above the contents list. */
export const DOCS_RAIL_SLOT_ID = "docs-rail-slot";

/**
 * Keeps `item` inside the rail's own viewport. Assigned to scrollTop rather
 * than using scrollIntoView, which would also scroll the window and undo the
 * reader's position on every section change.
 */
export function scrollRailToItem(rail: HTMLElement, item: HTMLElement) {
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < rail.scrollTop) rail.scrollTop = top;
  else if (bottom > rail.scrollTop + rail.clientHeight) {
    rail.scrollTop = bottom - rail.clientHeight;
  }
}

interface DocsTocProps {
  items: TocItem[];
  activeSection: string;
}

/** The rail on the right, shown only where there is room for a third column. */
export function DocsToc({ items, activeSection }: DocsTocProps) {
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const rail = railRef.current;
    const active = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (rail && active) scrollRailToItem(rail, active);
  }, [activeSection]);

  if (items.length === 0) return null;

  return (
    <aside className="hidden xl:block w-56 shrink-0">
      {/* Same offsets as the sidebar (docs-sidebar.tsx): the nav above moves
          down by the banner heights, so this has to as well. */}
      <div
        ref={railRef}
        className="sticky top-[calc(4rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] h-[calc(100vh-4rem-var(--vr-banner-h,0px)-var(--vr-imp-banner-h,0px))] overflow-y-auto py-8 px-4 transition-[top] duration-300"
      >
        <div id={DOCS_RAIL_SLOT_ID} />
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          On this page
        </h2>
        <nav aria-label="On this page" className="border-l border-border/50">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={activeSection === item.id ? "true" : undefined}
              className={cn(
                "-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors",
                "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-r-sm",
                item.level === 2 && "pl-7 text-[13px]",
                activeSection === item.id
                  ? "border-primary font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}
