"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import { LEGAL_NAV_PAGES } from "./legal-pages";

export function LegalNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Legal documents"
      className="mb-8 flex flex-wrap gap-2 border-b border-border/50 pb-6"
    >
      {LEGAL_NAV_PAGES.map((page) => {
        const isActive = pathname === page.href;
        const Icon = page.icon;
        return (
          <Link
            key={page.href}
            href={page.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // rounded-md, not rounded-lg: these are chips, and the radius
              // ladder in STYLE.md puts a control-shaped thing one rung
              // below the card it sits on.
              // min-h-9 gives the row a consistent height whether or not the
              // label wraps to the short form on a phone.
              "flex min-h-9 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "border-primary/30 bg-primary/10 font-medium text-primary"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{page.label}</span>
            <span className="sm:hidden">{page.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
