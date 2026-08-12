import type { NavItem, NavSection } from "./docs-types";

/**
 * The documentation set, in reading order.
 *
 * One table drives the sidebar, the mobile drawer, the breadcrumb label, and
 * the previous/next pager, so those four can never disagree about what the
 * set contains or what a page is called. Every label except "Introduction"
 * (the /docs index, which carries a longer marketing-style H1) matches the
 * target page's own <h1> exactly, so a reader who clicks "Rate Limits" lands
 * on a page titled Rate Limits.
 */
export const DOCS_NAV: NavSection[] = [
  {
    title: "Start here",
    items: [
      {
        href: "/docs",
        label: "Introduction",
        summary: "What the scanner does and how to get a first result",
        exact: true,
      },
      {
        href: "/docs/setup",
        label: "Setup Guide",
        summary: "Install, migrate the database, run it locally",
      },
      {
        href: "/docs/extension",
        label: "Browser Extension",
        summary: "Scan from the toolbar, auto-scan, on-page alerts",
      },
    ],
  },
  {
    title: "Running your own",
    items: [
      {
        href: "/docs/self-hosting",
        label: "Self-Hosting",
        summary: "docker-compose, TLS, backups, upgrades",
      },
      {
        href: "/docs/config",
        label: "Configuration",
        summary: "Every CONFIG_* value and every environment variable",
      },
    ],
  },
  {
    title: "API reference",
    items: [
      {
        href: "/docs/api",
        label: "API Reference",
        summary: "Endpoints, request and response shapes, error codes",
      },
      {
        href: "/docs/webhooks",
        label: "Webhooks",
        summary: "Discord, Slack, and plain JSON delivery",
      },
      {
        href: "/docs/rate-limits",
        label: "Rate Limits",
        summary: "Daily quotas, per-IP limits, and the 429 contract",
      },
    ],
  },
  {
    title: "Internals",
    items: [
      {
        href: "/docs/architecture",
        label: "Architecture",
        summary: "Request lifecycle, subsystems, and the check registry",
      },
      {
        href: "/docs/developers",
        label: "Developer Documentation",
        summary: "Local workflow, scripts, and building an SDK",
      },
    ],
  },
];

/** Flat reading order, used by the pager and the breadcrumb. */
export const DOCS_PAGES: NavItem[] = DOCS_NAV.flatMap(
  (section) => section.items,
);

export function isNavItemActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname === item.href;
}

/** The entry for the current path, plus what sits either side of it. */
export function docsPageContext(pathname: string) {
  const index = DOCS_PAGES.findIndex((item) => item.href === pathname);
  if (index === -1) {
    return { current: undefined, previous: undefined, next: undefined };
  }
  return {
    current: DOCS_PAGES[index],
    previous: index > 0 ? DOCS_PAGES[index - 1] : undefined,
    next: index < DOCS_PAGES.length - 1 ? DOCS_PAGES[index + 1] : undefined,
  };
}
