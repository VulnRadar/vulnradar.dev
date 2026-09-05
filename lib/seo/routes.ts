// Single source of truth for which routes exist, which ones search engines
// should index, and how important each one is.
//
// app/sitemap.ts and app/robots.ts both read from here, so a new public page
// only has to be added once and cannot end up in the sitemap while being
// disallowed in robots.txt.

import { getAllChecks, SEO_CATEGORIES } from "@/lib/seo/checks-content";
import { getAllAlternatives } from "@/lib/seo/alternatives";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import { CHECK_CATEGORY_LAST_MODIFIED } from "@/lib/config/check-stats.generated";

export interface PublicRoute {
  path: string;
  /** Relative priority within the site, 0 to 1. */
  priority: number;
  changeFrequency:
    "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /**
   * `YYYY-MM-DD` of the last real change to the page's source data, where we
   * can derive one. Omitted otherwise, and app/sitemap.ts then falls back to
   * the build timestamp for that route only.
   */
  lastModified?: string;
}

/**
 * Hand-listed pages that should be crawled and indexed. Ordered roughly by
 * how much we want them to rank. The large SEO surfaces (per-check,
 * per-category, per-competitor) are appended below, generated from the same
 * data the pages render so the sitemap can never drift out of sync with them.
 */
const STATIC_PUBLIC_ROUTES: readonly PublicRoute[] = [
  // The ROOT, not /landing. / permanently redirects to /landing, so both
  // serve the same page, and app/landing/page.tsx now declares "/" as its
  // canonical. A sitemap listing /landing while the page canonicalises to /
  // is two contradictory signals about the same document, which is what left
  // Search Console reporting a duplicate with no canonical selected.
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
  { path: "/demo", priority: 0.9, changeFrequency: "weekly" },
  { path: "/checks", priority: 0.8, changeFrequency: "monthly" },
  { path: "/alternatives", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools/api-scanner", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools/link-checker", priority: 0.7, changeFrequency: "monthly" },
  { path: "/public-scans", priority: 0.6, changeFrequency: "daily" },
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

// The docs set used to be hand-typed here, and it drifted: DOCS_NAV had grown
// to 20 entries while this file still listed 11, so nine indexable docs pages
// (/docs/cli, /docs/github, /docs/teams, /docs/triage, /docs/sharing,
// /docs/reports, /docs/ai, /docs/scheduled-scans, /docs/account-security) had
// their own metadata and JSON-LD but no sitemap entry. Deriving them from the
// same table that renders the sidebar makes that impossible to repeat.
// docs-nav.ts is a plain data module with no client-only imports.
const DOCS_ROUTES: readonly PublicRoute[] = DOCS_PAGES.map((page) => ({
  path: page.href,
  priority: page.href === "/docs" ? 0.8 : 0.7,
  changeFrequency: "monthly" as const,
}));

const CATEGORY_ROUTES: readonly PublicRoute[] = SEO_CATEGORIES.map(
  (category) => ({
    path: `/checks/category/${category}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
    // Same source file as every check page it lists.
    lastModified: CHECK_CATEGORY_LAST_MODIFIED[category],
  }),
);

const ALTERNATIVE_ROUTES: readonly PublicRoute[] = getAllAlternatives().map(
  (alt) => ({
    path: `/alternatives/${alt.slug}`,
    priority: 0.6,
    changeFrequency: "monthly" as const,
  }),
);

// The whole per-check set used to share one build timestamp with everything
// else in the sitemap, which claimed all ~820 URLs changed at the same instant
// on every deploy: Google's documented response to a lastmod that is not
// consistently accurate is to ignore the field for the entire site. A check
// page's content is its entry in lib/scanner/checks-data/<category>.json, so
// the last commit that touched that file is its real modification date.
// Per-category is the finest granularity git gives us here, which still
// separates a category edited this week from one untouched for months.
const CHECK_ROUTES: readonly PublicRoute[] = getAllChecks().map((check) => ({
  path: `/checks/${check.id}`,
  priority: 0.5,
  changeFrequency: "monthly" as const,
  lastModified: CHECK_CATEGORY_LAST_MODIFIED[check.category],
}));

/**
 * Every crawlable, indexable route: the hand-listed pages plus the generated
 * per-category, per-competitor, and per-check pages.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  ...STATIC_PUBLIC_ROUTES,
  ...DOCS_ROUTES,
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
  // app/admin/layout.tsx serves privatePageMetadata("Admin", "/admin") and
  // says the point is to save crawl budget, but the noindex meta tag only
  // stops indexing AFTER the fetch. Without the Disallow, a crawler still
  // spends a fetch on /admin and lands on the /login?redirect=/admin
  // duplicate the QUERY_DISALLOW rule in app/robots.ts exists to stop.
  // Prefix matching covers /admin/ai-chats/<id> (AUDIT-014#seo-15).
  // Auth-gated: redirects anon visitors (Googlebot included) to
  // /login?redirect=/compare, so an indexed copy is a thin duplicate of the
  // login page and it kept generating a duplicate /login?redirect= URL in
  // Search Console. Not a public marketing page.
  "/shared/",
  "/host/",
  "/browser/",
  // Auth-gated, same as /compare above. The badge BUILDER reads the caller's
  // own scan history and is out of PUBLIC_PATHS, so a crawl of it lands on
  // /login?redirect=/badge. The badge IMAGE it produces lives under /api/ and
  // is disallowed by the first entry in this list, which is right too: it is
  // an image embedded on someone else's page, not a page of ours to index.
  "/badge",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/unsubscribe",
  // Token-gated staff invite acceptance. Public in the middleware sense (the
  // invitee has no account yet, see lib/config/public-paths.ts) but every URL
  // carries a single-use token, so an indexed copy is a dead link at best and
  // a leaked invite at worst.
  "/staff-invite",
  // Development-only workbenches (app/dev/modals). app/dev/modals/page.tsx
  // already calls notFound() in a production build and "/dev" is deliberately
  // absent from PUBLIC_PATHS, so this is the third layer rather than the only
  // one: it keeps the path out of robots.txt and the sitemap even if somebody
  // later adds a /dev page that forgets the gate.
  "/dev",
  // Auth-gated app routes are deliberately NOT listed here.
  //
  // Disallow does not prevent indexing. Google can index a blocked URL from an
  // external link, and, worse, a Disallow stops the crawler from ever fetching
  // the page, which means it never reads the noindex tag that would actually
  // keep it out. Disallow plus noindex is self-defeating: the first blocks the
  // second from being seen. Search Console reported exactly that state for
  // /compare, /dashboard and /profile under "Blocked by robots.txt".
  //
  // Those routes all declare privatePageMetadata, which sets
  // robots: { index: false, follow: false }, and they require a session, so an
  // anonymous crawler that follows one lands on the login page. Letting the
  // crawler fetch them is what makes the noindex effective. The cost is a
  // handful of crawl fetches.
  //
  // It also stops robots.txt publishing the location of the admin panel, which
  // our own scanner reports as a medium finding on other people's sites and
  // was reporting on ours. That is a consequence of the change rather than the
  // reason for it: the indexing argument stands on its own.
  //
  // /api/ stays: it serves no HTML, so there is no tag to carry a noindex and
  // Disallow is the only control available.
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
