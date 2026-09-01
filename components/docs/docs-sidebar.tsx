"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import {
  API_CURRENT_VERSION,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/client-constants";
import { DOCS_NAV, DOCS_PAGES, isNavItemActive } from "./docs-nav";

/**
 * Grouped rather than a flat list of nine links: the groups are what tell a
 * reader whether the page they want is a guide, a reference, or internals.
 * No icons, because a row of nine near-identical glyphs carries no
 * information the label does not already carry.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const position = DOCS_PAGES.findIndex((item) => item.href === pathname);

  return (
    <aside className="hidden lg:block w-64 shrink-0 border-r border-border/50">
      <nav
        aria-label="Documentation"
        className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto py-8 px-6"
      >
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            Documentation
          </p>
          {position >= 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              Page {position + 1} of {DOCS_PAGES.length}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {DOCS_NAV.map((section) => (
            <div key={section.title}>
              <h2 className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h2>
              <ul className="border-l border-border/50">
                {section.items.map((item) => {
                  const isActive = isNavItemActive(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "-ml-px block border-l-2 py-1.5 pl-3 pr-2 text-sm transition-colors",
                          "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset rounded-r-sm",
                          isActive
                            ? "border-primary font-medium text-primary"
                            : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <dl className="mt-8 space-y-1.5 border-t border-border/50 pt-6 text-xs">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">API</dt>
            <dd className="font-mono text-foreground">{API_CURRENT_VERSION}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Engine</dt>
            <dd className="font-mono text-foreground">{ENGINE_VERSION}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Checks</dt>
            <dd className="font-mono text-foreground">{TOTAL_CHECKS_LABEL}</dd>
          </div>
        </dl>
      </nav>
    </aside>
  );
}
