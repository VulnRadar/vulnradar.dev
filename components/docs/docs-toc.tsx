"use client";

import { cn } from "@/lib/ui/utils";
import type { TocItem } from "./docs-types";

interface DocsTocProps {
  items: TocItem[];
  activeSection: string;
}

/** The rail on the right, shown only where there is room for a third column. */
export function DocsToc({ items, activeSection }: DocsTocProps) {
  if (items.length === 0) return null;

  return (
    <aside className="hidden xl:block w-56 shrink-0">
      <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-4">
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

/**
 * The same contents inline above the article, for the widths where the right
 * rail is hidden. Without it, a reader on a laptop or a phone has no way to
 * see the shape of a 700-line page except by scrolling it.
 *
 * <details> rather than a custom disclosure: it is keyboard operable and
 * announced correctly with no JavaScript of ours in the path.
 */
export function DocsInlineToc({ items }: { items: TocItem[] }) {
  if (items.length === 0) return null;

  return (
    <details className="xl:hidden mt-8 rounded-lg border border-border/60 bg-muted/30">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground marker:content-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-lg">
        On this page
        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
          {items.length} sections
        </span>
      </summary>
      <nav
        aria-label="On this page"
        className="border-t border-border/60 px-2 py-2"
      >
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={cn(
                  "block rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors",
                  "hover:bg-muted hover:text-foreground",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  item.level === 2 && "pl-6 text-[13px]",
                )}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
