// Single source of truth for which routes exist, which ones search engines
// should index, and how important each one is.
//
// app/sitemap.ts and app/robots.ts both read from here, so a new public page
// only has to be added once and cannot end up in the sitemap while being
// disallowed in robots.txt.

import { getAllChecks, SEO_CATEGORIES } from "@/lib/seo/checks-content";
import { getAllAlternatives } from "@/lib/seo/alternatives";

export interface PublicRoute {
  path: string;
  /** Relative priority within the site, 0 to 1. */
  priority: number;
  changeFrequency:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
}

/**
 * Hand-listed pages that should be crawled and indexed. Ordered roughly by
 * how much we want them to rank. The large SEO surfaces (per-check,
 * per-category, per-competitor) are appended below, generated from the same
 * data the pages render so the sitemap can never drift out of sync with them.
 */
const STATIC_PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/landing", priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
  { path: "/demo", priority: 0.9, changeFrequency: "weekly" },
  { path: "/docs", priority: 0.8, changeFrequency: "weekly" },
  { path: "/docs/api", priority: 0.8, changeFrequency: "weekly" },
  { path: "/checks", priority: 0.8, changeFrequency: "monthly" },
  { path: "/docs/setup", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/extension", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/self-hosting", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/developers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/alternatives", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools/api-scanner", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools/link-checker", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/architecture", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/webhooks", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/rate-limits", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/config", priority: 0.6, changeFrequency: "monthly" },
  { path: "/public-scans", priority: 0.6, changeFrequency: "hourly" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/security", priority: 0.5, changeFrequency: "yearly" },
  { path: "/donate", priority: 0.4, changeFrequency: "yearly" },
  { path: "/signup", priority: 0.6, changeFrequency: "monthly" },
  { path: "/login", priority: 0.4, changeFrequency: "monthly" },
  { path: "/legal", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/acceptable-use", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/disclaimer", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/accessibility", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/dmca", priority: 0.2, changeFrequency: "yearly" },
];

// Generated SEO routes. Built from the exact same loaders the pages use, so
// adding a check JSON entry or a competitor automatically adds its sitemap
// entry with no second edit here.
const CATEGORY_ROUTES: readonly PublicRoute[] = SEO_CATEGORIES.map(
  (category) => ({
    path: `/checks/category/${category}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  }),
);

const ALTERNATIVE_ROUTES: readonly PublicRoute[] = getAllAlternatives().map(
  (alt) => ({
    path: `/alternatives/${alt.slug}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  }),
);

const CHECK_ROUTES: readonly PublicRoute[] = getAllChecks().map((check) => ({
  path: `/checks/${check.id}`,
  priority: 0.5,
  changeFrequency: "monthly" as const,
}));

/**
 * Every crawlable, indexable route: the hand-listed pages plus the generated
 * per-category, per-competitor, and per-check pages.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  ...STATIC_PUBLIC_ROUTES,
  ...CATEGORY_ROUTES,
  ...ALTERNATIVE_ROUTES,
  ...CHECK_ROUTES,
];

/**
 * Paths crawlers must not index. Two kinds live here:
 *
 *  - Authenticated surfaces. Crawling them wastes budget and they render as
 *    a login redirect anyway, so an indexed copy is a thin duplicate.
 *  - Tokenised or per-entity URLs (/shared/<token>, /browser/<id>,
 *    /host/<hostname>). Not enumerable ahead of time, so there is no fixed
 *    list to publish a sitemap entry or canonical for -- unlisted by design,
 *    not because the page is private.
 */
export const DISALLOWED_PATHS: readonly string[] = [
  "/api/",
  "/dashboard",
  "/profile",
  // Auth-gated: redirects anon visitors (Googlebot included) to
  // /login?redirect=/compare, so an indexed copy is a thin duplicate of the
  // login page and it kept generating a duplicate /login?redirect= URL in
  // Search Console. Not a public marketing page.
  "/compare",
  "/history",
  "/assets",
  "/attack-surface",
  "/repos",
  "/shares",
  "/shared/",
  "/host/",
  "/teams",
  "/checkout",
  "/browser/",
  "/badge",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/unsubscribe",
] as const;

/**
 * Paths VulnRadar's own scan crawler skips during discovery, published to
 * robots.txt under a `User-agent: VulnRadar` group (app/robots.ts) and honored
 * by lib/scanner/crawl-discovery.ts. These are large SEO surfaces (the ~750
 * per-check "how to fix" guides): real public pages that STAY in the sitemap
 * and fully indexable by search engines via the `*` group, but enumerating all
 * of them fills a multi-page scan with our own marketing pages. This is also
 * the documented pattern for anyone else: a `User-agent: VulnRadar` Disallow
 * group keeps pages out of a VulnRadar scan without hiding them from search.
 */
export const SCANNER_DISALLOWED_PATHS: readonly string[] = ["/checks"] as const;
