import { APP_NAME } from "@/lib/config/client-constants";

import type { NavItem, NavSection } from "./docs-types";
import { toc as accountSecurityToc } from "./toc/account-security";
import { toc as administrationToc } from "./toc/administration";
import { toc as aiToc } from "./toc/ai";
import { toc as apiToc } from "./toc/api";
import { toc as apiPlaygroundToc } from "./toc/api-playground";
import { toc as architectureToc } from "./toc/architecture";
import { toc as billingToc } from "./toc/billing";
import { toc as cliToc } from "./toc/cli";
import { toc as configToc } from "./toc/config";
import { toc as developersToc } from "./toc/developers";
import { toc as extensionToc } from "./toc/extension";
import { toc as githubToc } from "./toc/github";
import { toc as homeToc } from "./toc/home";
import { toc as rateLimitsToc } from "./toc/rate-limits";
import { toc as reportsToc } from "./toc/reports";
import { toc as scanningToc } from "./toc/scanning";
import { toc as scheduledScansToc } from "./toc/scheduled-scans";
import { toc as selfHostingToc } from "./toc/self-hosting";
import { toc as setupToc } from "./toc/setup";
import { toc as sharingToc } from "./toc/sharing";
import { toc as teamsToc } from "./toc/teams";
import { toc as triageToc } from "./toc/triage";
import { toc as troubleshootingToc } from "./toc/troubleshooting";
import { toc as webhooksToc } from "./toc/webhooks";

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
    id: "start-here",
    title: "Start here",
    audience: "use",
    items: [
      {
        href: "/docs",
        template: "concept",
        source: "app/docs/page.tsx",
        toc: homeToc,
        label: "Introduction",
        summary: "What the scanner does and how to get a first result",
        exact: true,
      },
      {
        href: "/docs/setup",
        template: "guide",
        source: "app/docs/setup/page.tsx",
        toc: setupToc,
        label: "Setup Guide",
        summary: "Install, migrate the database, run it locally",
      },
      {
        href: "/docs/extension",
        template: "guide",
        source: "app/docs/extension/page.tsx",
        toc: extensionToc,
        label: "Browser Extension",
        summary: "Scan from the toolbar, auto-scan, on-page alerts",
      },
    ],
  },
  {
    id: "using",
    title: `Using ${APP_NAME}`,
    audience: "use",
    items: [
      {
        href: "/docs/scanning",
        template: "guide",
        source: "app/docs/scanning/page.tsx",
        toc: scanningToc,
        label: "Scanning a Site",
        summary: "Quick, Deep and Bulk, the result panels, and signing in",
      },
      {
        href: "/docs/scheduled-scans",
        template: "guide",
        source: "app/docs/scheduled-scans/page.tsx",
        toc: scheduledScansToc,
        label: "Scheduled Scans",
        summary: "Recurring scans on a schedule, with regression alerts",
      },
      {
        href: "/docs/triage",
        template: "guide",
        source: "app/docs/triage/page.tsx",
        toc: triageToc,
        label: "Triage & Remediation",
        summary: "Track findings from open to fixed, plus support tickets",
      },
      {
        href: "/docs/teams",
        template: "guide",
        source: "app/docs/teams/page.tsx",
        toc: teamsToc,
        label: "Teams",
        summary: "Roles, invitations, and sharing scans across a team",
      },
      {
        href: "/docs/sharing",
        template: "guide",
        source: "app/docs/sharing/page.tsx",
        toc: sharingToc,
        label: "Sharing & Public Pages",
        summary: "Share links, the public directory, host reports, badges",
      },
      {
        href: "/docs/account-security",
        template: "guide",
        source: "app/docs/account-security/page.tsx",
        toc: accountSecurityToc,
        label: "Account Security",
        summary: "2FA, sessions, social logins, and your data",
      },
      {
        href: "/docs/billing",
        template: "reference",
        source: "app/docs/billing/page.tsx",
        toc: billingToc,
        label: "Plans and Billing",
        summary: "Plan limits, credits, upgrading, and cancelling",
      },
      {
        href: "/docs/troubleshooting",
        template: "reference",
        source: "app/docs/troubleshooting/page.tsx",
        toc: troubleshootingToc,
        label: "Troubleshooting Scans",
        summary: "Failures, timeouts, blocked targets, and empty results",
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations & AI",
    audience: "use",
    items: [
      {
        href: "/docs/github",
        template: "guide",
        source: "app/docs/github/page.tsx",
        toc: githubToc,
        label: "GitHub Scanning",
        summary: "Scan a connected repo for secrets and code flaws",
      },
      {
        href: "/docs/ai",
        template: "guide",
        source: "app/docs/ai/page.tsx",
        toc: aiToc,
        label: "AI Features",
        summary: "Vera chat, verification, summaries, repo review, BYOK keys",
      },
    ],
  },
  {
    id: "running",
    title: "Running your own",
    audience: "run",
    items: [
      {
        href: "/docs/self-hosting",
        template: "quickstart",
        source: "app/docs/self-hosting/page.tsx",
        toc: selfHostingToc,
        label: "Self-Hosting",
        summary: "docker-compose, TLS, backups, upgrades",
      },
      {
        href: "/docs/administration",
        template: "reference",
        source: "app/docs/administration/page.tsx",
        toc: administrationToc,
        label: "Administration",
        summary: "The admin panel, staff roles, backups, and retention",
      },
      {
        href: "/docs/config",
        template: "reference",
        source: "app/docs/config/page.tsx",
        toc: configToc,
        label: "Configuration",
        // Was "Every CONFIG_* value and every environment variable", which the
        // page does not deliver. The Settings tables are generated from
        // SETTINGS_REGISTRY, so they do list every key the admin panel can
        // edit; what the page does not list is the CONFIG_* constants outside
        // the registry, or every environment variable. Layer 1 names only the
        // values an operator is likely to change. Promising completeness makes
        // a reader stop looking after not finding their value.
        summary: "How configuration resolves, and the values you will change",
      },
    ],
  },
  {
    id: "api-reference",
    title: "API reference",
    audience: "build",
    items: [
      {
        href: "/docs/api",
        template: "reference",
        source: "app/docs/api/page.tsx",
        toc: apiToc,
        label: "API Reference",
        summary: "Endpoints, request and response shapes, error codes",
      },
      {
        href: "/docs/api/playground",
        template: "guide",
        source: "app/docs/api/playground/page.tsx",
        toc: apiPlaygroundToc,
        label: "API Playground",
        summary: "Send live calls and copy them as code in your language",
      },
      {
        href: "/docs/reports",
        template: "guide",
        source: "app/docs/reports/page.tsx",
        toc: reportsToc,
        label: "Reports & Compliance",
        summary: "Export SARIF, PDF, Markdown, or a compliance crosswalk",
      },
      {
        href: "/docs/cli",
        template: "guide",
        source: "app/docs/cli/page.tsx",
        toc: cliToc,
        label: "CLI",
        summary: "Run scans from the terminal and gate CI on findings",
      },
      {
        href: "/docs/webhooks",
        template: "guide",
        source: "app/docs/webhooks/page.tsx",
        toc: webhooksToc,
        label: "Webhooks",
        summary: "Discord, Slack, and plain JSON delivery",
      },
      {
        href: "/docs/rate-limits",
        template: "reference",
        source: "app/docs/rate-limits/page.tsx",
        toc: rateLimitsToc,
        label: "Rate Limits",
        summary: "Daily quotas, per-IP limits, and the 429 contract",
      },
    ],
  },
  {
    id: "internals",
    title: "Internals",
    audience: "run",
    items: [
      {
        href: "/docs/architecture",
        template: "concept",
        source: "app/docs/architecture/page.tsx",
        toc: architectureToc,
        label: "Architecture",
        summary: "Request lifecycle, subsystems, and the check registry",
      },
      {
        href: "/docs/developers",
        template: "guide",
        source: "app/docs/developers/page.tsx",
        toc: developersToc,
        label: "Developer Documentation",
        summary: "Local workflow, scripts, and building an SDK",
      },
    ],
  },
];

function withChildren(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...withChildren(item.children ?? [])]);
}

/** Flat reading order, for the sitemap, llms.txt and anything else that lists every page. */
export const DOCS_PAGES: NavItem[] = DOCS_NAV.flatMap((section) =>
  withChildren(section.items),
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

export interface DocsPageContext {
  section?: NavSection;
  current?: NavItem;
  previous?: NavItem;
  next?: NavItem;
  /** 1-based position on a numbered path; undefined everywhere else. */
  stepIndex?: number;
}

/**
 * The entry for the current path, its section, and what sits either side of it
 * within that section. Previous and next stop at the section's edge: a pager
 * that walked the whole set sent a reader finishing the scan guides into the
 * self-hosting install.
 */
export function docsPageContext(pathname: string): DocsPageContext {
  for (const section of DOCS_NAV) {
    const items = withChildren(section.items);
    const index = items.findIndex((item) => item.href === pathname);
    if (index === -1) continue;
    return {
      section,
      current: items[index],
      previous: items[index - 1],
      next: items[index + 1],
      stepIndex: section.path ? index + 1 : undefined,
    };
  }
  return {};
}
