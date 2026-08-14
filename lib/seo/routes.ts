// Single source of truth for which routes exist, which ones search engines
// should index, and how important each one is.
//
// app/sitemap.ts and app/robots.ts both read from here, so a new public page
// only has to be added once and cannot end up in the sitemap while being
// disallowed in robots.txt.

export interface PublicRoute {
  path: string;
  /** Relative priority within the site, 0 to 1. */
  priority: number;
  changeFrequency:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
}

/**
 * Pages that should be crawled and indexed. Ordered roughly by how much we
 * want them to rank.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/landing", priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
  { path: "/demo", priority: 0.9, changeFrequency: "weekly" },
  { path: "/docs", priority: 0.8, changeFrequency: "weekly" },
  { path: "/docs/api", priority: 0.8, changeFrequency: "weekly" },
  { path: "/docs/setup", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/extension", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/self-hosting", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/developers", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs/architecture", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/webhooks", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/rate-limits", priority: 0.6, changeFrequency: "monthly" },
  { path: "/docs/config", priority: 0.6, changeFrequency: "monthly" },
  { path: "/compare", priority: 0.7, changeFrequency: "monthly" },
  { path: "/public-scans", priority: 0.6, changeFrequency: "hourly" },
  { path: "/changelog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
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
] as const;

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
  "/history",
  "/assets",
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
