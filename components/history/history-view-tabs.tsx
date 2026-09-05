"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { toggles } from "@/lib/ui/animations";
import { tourAnchor } from "@/lib/tour/anchors";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import {
  visibleSurfaces,
  type FeatureSurface,
} from "@/lib/config/feature-surfaces";

const TABS: {
  href: string;
  label: string;
  /** Client feature flag this destination depends on, if any. */
  feature?: FeatureSurface;
}[] = [
  { href: ROUTES.HISTORY, label: "My History" },
  { href: ROUTES.ASSETS, label: "Assets" },
  {
    href: ROUTES.ATTACK_SURFACE,
    label: "Attack Surface",
    feature: "domainVerification",
  },
  { href: ROUTES.PUBLIC_SCANS, label: "Public Scans" },
];

/**
 * Shared tab switcher between /history (your own scans, requires login),
 * /assets (every distinct host you've scanned, grouped), and /public-scans
 * (everyone's publicly-listed scans, no login needed) -- three different
 * views over the same underlying scan history. "Public Scans" was already
 * moved here from its own top-level nav item (it was cramped there,
 * wrapping to two lines on smaller desktop widths); Assets followed the
 * same reasoning, since it's the same kind of "different view of your scan
 * history" rather than a distinct top-level feature.
 */
export function HistoryViewTabs() {
  const pathname = usePathname();
  // /attack-surface is the domain-verification portfolio and nothing else, so
  // with FEATURE_DOMAIN_VERIFICATION off the tab leads to a page whose only
  // control cannot be used. The flag reads its compiled build-time default
  // until the live config lands, so the strip does not reflow after paint on a
  // deployment that sets flags at build time.
  const tabs = visibleSurfaces(TABS, useClientConfig());

  return (
    /* The four labels need roughly 409px and a 390px phone offers about 358.
       With no overflow-x-auto and no whitespace-nowrap the flex children were
       floored at their min-content width, so every multi-word label wrapped
       ("Attack / Surface") and the border-b baseline came apart across four
       top-level pages. Scroll instead of wrap, and py-3 brings the target to
       44px. -mx-4 px-4 lets the scroll run edge to edge inside the page's own
       px-4 container, copying the profile page's mobile strip. */
    <div className="-mx-4 overflow-x-auto scrollbar-hide px-4 sm:mx-0 sm:px-0">
      {/* w-max + min-w-full: as wide as the tabs need when they overflow, but
          still full width otherwise so the bottom rule spans the page. */}
      <div
        {...tourAnchor("historyTabs")}
        className="flex w-max min-w-full gap-1 border-b border-border/50"
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium",
                // The underline is a border colour, so the shared toggle
                // timing carries it; without a duration it inherited
                // Tailwind's default and drifted from every other toggle.
                toggles.control,
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
    </div>
  );
}
