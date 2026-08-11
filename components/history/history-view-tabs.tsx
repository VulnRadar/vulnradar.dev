"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/config/constants";
import { cn } from "@/lib/ui/utils";

const TABS = [
  { href: ROUTES.HISTORY, label: "My History" },
  { href: ROUTES.PUBLIC_SCANS, label: "Public Scans" },
];

/**
 * Shared tab switcher between /history (your own scans, requires login)
 * and /public-scans (everyone's publicly-listed scans, no login needed).
 * Replaces "Public Scans" as its own top-level nav item -- it was cramped
 * there (wrapped to two lines on smaller desktop widths) and this groups
 * it with the feature it's actually a variant of.
 */
export function HistoryViewTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-border/50">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
