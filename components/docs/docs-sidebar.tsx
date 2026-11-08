"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ui/utils";
import {
  API_CURRENT_VERSION,
  ENGINE_VERSION,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/client-constants";
import { DOCS_NAV, docsPageContext, isNavItemActive } from "./docs-nav";
import { DocsSearchButton } from "./docs-search";
import type { NavSection } from "./docs-types";

/**
 * A group is open when the page you are on belongs to its audience, when it is
 * the shared reference, and everywhere on the docs home, where there is no
 * current audience to favour. A reader can still open any other one.
 */
export function isSidebarGroupOpen(
  section: NavSection,
  pathname: string,
): boolean {
  if (section.audience === "shared" || pathname === "/docs") return true;
  const current = docsPageContext(pathname).section;
  return !current || current.audience === section.audience;
}

function SidebarGroupLinks({
  section,
  pathname,
}: {
  section: NavSection;
  pathname: string;
}) {
  return (
    <ul className="border-l border-border/50">
      {section.items.map((item, index) => {
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
              {section.path && (
                <span className="tabular-nums">{index + 1}. </span>
              )}
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const groupHeading =
  "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Grouped rather than a flat list of nine links: the groups are what tell a
 * reader whether the page they want is a guide, a reference, or internals.
 * No icons, because a row of nine near-identical glyphs carries no
 * information the label does not already carry.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const { section, stepIndex } = docsPageContext(pathname);
  const navRef = useRef<HTMLElement | null>(null);

  // Keeps the current page in the rail's own viewport. scrollTop rather than
  // scrollIntoView, which would also scroll the window. Only when it is out of
  // view: on a click inside the rail the link is already where the reader's
  // pointer is, and moving the list under it would be a jolt.
  useEffect(() => {
    const nav = navRef.current;
    const link = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !link) return;
    const top = link.offsetTop;
    const bottom = top + link.offsetHeight;
    if (top < nav.scrollTop || bottom > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = top - nav.clientHeight / 3;
    }
  }, [pathname]);

  return (
    <aside className="hidden lg:block w-64 shrink-0 border-r border-border/50">
      <nav
        ref={navRef}
        aria-label="Documentation"
        // The public nav above sticks at the banner offsets (site notice and
        // staff impersonation), so the rail has to stick below that too: at a
        // flat 4rem the nav slid down over the rail's heading and first links
        // whenever a banner was up, and the height ran the same distance past
        // the bottom of the viewport.
        className="sticky top-[calc(4rem+var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px))] h-[calc(100vh-4rem-var(--vr-banner-h,0px)-var(--vr-imp-banner-h,0px))] overflow-y-auto py-8 px-6 transition-[top] duration-300"
      >
        <DocsSearchButton className="mb-5" />

        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            Documentation
          </p>
          {section?.path && stepIndex && (
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              Step {stepIndex} of {section.items.length}
            </p>
          )}
        </div>

        <div className="space-y-6">
          {DOCS_NAV.map((group) =>
            group.audience === "shared" ? (
              <div key={group.id}>
                <h2 className={cn(groupHeading, "mb-1.5 px-2")}>
                  {group.title}
                </h2>
                <SidebarGroupLinks section={group} pathname={pathname} />
              </div>
            ) : (
              <details
                key={group.id}
                open={isSidebarGroupOpen(group, pathname)}
              >
                <summary className="mb-1 cursor-pointer rounded-sm px-2 py-1 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                  <h2 className={cn(groupHeading, "inline")}>{group.title}</h2>
                </summary>
                <SidebarGroupLinks section={group} pathname={pathname} />
              </details>
            ),
          )}
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
