import { APP_NAME } from "@/lib/config/client-constants";

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
    title: `Using ${APP_NAME}`,
    items: [
      {
        href: "/docs/scheduled-scans",
        label: "Scheduled Scans",
        summary: "Recurring scans on a schedule, with regression alerts",
      },
      {
        href: "/docs/triage",
        label: "Triage & Remediation",
        summary: "Track findings from open to fixed, plus support tickets",
      },
      {
        href: "/docs/teams",
        label: "Teams",
        summary: "Roles, invitations, and sharing scans across a team",
      },
      {
        href: "/docs/sharing",
        label: "Sharing & Public Pages",
        summary: "Share links, the public directory, host reports, badges",
      },
      {
        href: "/docs/account-security",
        label: "Account Security",
        summary: "2FA, sessions, social logins, and your data",
      },
      {
        href: "/docs/billing",
        label: "Plans and Billing",
        summary: "Plan limits, credits, upgrading, and cancelling",
      },
      {
        href: "/docs/troubleshooting",
        label: "Troubleshooting Scans",
        summary: "Failures, timeouts, blocked targets, and empty results",
      },
    ],
  },
  {
    title: "Integrations & AI",
    items: [
      {
        href: "/docs/github",
        label: "GitHub Scanning",
        summary: "Scan a connected repo for secrets and code flaws",
      },
      {
        href: "/docs/ai",
        label: "AI Features",
        summary: "Vera chat, AI verification, summaries, and BYOK keys",
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
        href: "/docs/administration",
        label: "Administration",
        summary: "The admin panel, staff roles, backups, and retention",
      },
      {
        href: "/docs/config",
        label: "Configuration",
        // Was "Every CONFIG_* value and every environment variable", which the
        // page does not deliver: it names 76 of the 308 CONFIG_* constants and
        // 61 of the 267 runtime settings keys. Promising completeness makes a
        // reader stop looking after not finding their value.
        summary: "How configuration resolves, and the values you will change",
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
        href: "/docs/api/playground",
        label: "API Playground",
        summary: "Send live calls and copy them as code in your language",
      },
      {
        href: "/docs/reports",
        label: "Reports & Compliance",
        summary: "Export SARIF, PDF, Markdown, or a compliance crosswalk",
      },
      {
        href: "/docs/cli",
        label: "CLI",
        summary: "Run scans from the terminal and gate CI on findings",
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
  // Both branches of this ternary used to be `pathname === item.href`, so
  // `exact` did nothing and a sub-page lit no nav entry at all: on
  // /docs/api/playground the sidebar highlighted nothing, which reads as
  // having navigated out of the docs. `exact` exists for /docs itself, which
  // is a prefix of every other docs URL and would otherwise stay lit
  // everywhere; everything else matches its own path or anything under it.
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
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
