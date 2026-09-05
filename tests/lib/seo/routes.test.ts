/**
 * DISALLOWED_PATHS is what app/robots.ts publishes. A page can be noindex in
 * its own metadata and still be invited into robots.txt, which is what
 * happened to /admin (AUDIT-014#seo-15): the meta tag stops the indexing but
 * only after the crawler has already spent the fetch, and that fetch lands on
 * the /login?redirect=... duplicate the QUERY_DISALLOW rule exists to stop.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DISALLOWED_PATHS, PUBLIC_ROUTES } from "@/lib/seo/routes";
import { CHECK_CATEGORY_LAST_MODIFIED } from "@/lib/config/check-stats.generated";
import { getAllChecks, SEO_CATEGORIES } from "@/lib/seo/checks-content";
import { DOCS_PAGES } from "@/components/docs/docs-nav";
import sitemap from "@/app/sitemap";

const APP_DIR = join(process.cwd(), "app");

function isDisallowed(path: string): boolean {
  return DISALLOWED_PATHS.some((prefix) => path.startsWith(prefix));
}

/** Every layout.tsx under app/ that calls privatePageMetadata. */
function privateLayoutPaths(): string[] {
  const found: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "layout.tsx") continue;
      const source = readFileSync(full, "utf8");
      for (const match of source.matchAll(
        /privatePageMetadata\(\s*(?:"[^"]*"|`[^`]*`)\s*,\s*(?:"([^"]*)"|`([^`]*)`)/g,
      )) {
        const raw = match[1] ?? match[2] ?? "";
        // Template segments like `/host/${hostname}` compare on their static
        // prefix, which is what prefix matching keys on anyway.
        const path = raw.split("${")[0];
        if (path.startsWith("/")) found.push(path);
      }
    }
  }

  walk(APP_DIR);
  return [...new Set(found)];
}

describe("DISALLOWED_PATHS", () => {
  /**
   * The invariant inverted, deliberately.
   *
   * It used to be "every private route is disallowed". That is the wrong tool:
   * Disallow does not prevent indexing (Google can index a blocked URL from an
   * external link) and it stops the crawler fetching the page, so the noindex
   * tag that WOULD keep it out is never read. Disallow plus noindex is
   * self-defeating, and Search Console reported exactly that for /compare,
   * /dashboard and /profile under "Blocked by robots.txt".
   *
   * So the rule now is the opposite: a route that carries noindex must NOT be
   * disallowed, because the crawler has to reach it to see the tag. Anything
   * that cannot carry a tag, /api/ above all, still needs Disallow and is
   * exempt here.
   */
  it("lets the crawler reach every noindex route, so the tag is actually read", () => {
    // Two exemptions, and neither is about indexing.
    //
    // /api/ serves JSON: there is no document to put a meta tag in, so
    // Disallow is the only control that exists.
    //
    // The token pages are the more important one. A crawler that FETCHES a
    // password reset, email verification, unsubscribe or staff invite link can
    // consume the one-time token in it, and the user's real click then fails.
    // Keeping a crawler out of those is not an indexing decision at all, and
    // Disallow is the right tool for it. They are unguessable anyway, so
    // nothing is disclosed by naming the prefix.
    const CANNOT_CARRY_A_TAG = [
      "/api/",
      "/forgot-password",
      "/reset-password",
      "/verify-email",
      "/unsubscribe",
      "/staff-invite",
      "/badge",
      "/host/",
    ];
    const blocked = privateLayoutPaths().filter(
      (p) =>
        !CANNOT_CARRY_A_TAG.some((prefix) => p.startsWith(prefix)) &&
        isDisallowed(p),
    );
    expect(
      blocked,
      "these declare privatePageMetadata (noindex) and are also disallowed, " +
        "so the crawler can never fetch them to read the noindex",
    ).toEqual([]);
  });

  it("still disallows what cannot carry a noindex tag", () => {
    // /api/ serves JSON, so there is no document to put a meta tag in and
    // Disallow is the only control that applies.
    expect(isDisallowed("/api/")).toBe(true);
  });

  it("never disallows a route that is published as public and indexable", () => {
    const contradictions = PUBLIC_ROUTES.map((r) => r.path).filter((p) =>
      isDisallowed(p),
    );
    expect(contradictions).toEqual([]);
  });
});

/**
 * DOCS_NAV is the sidebar, the pager, the breadcrumb AND the sitemap's docs
 * entries (lib/seo/routes.ts derives DOCS_ROUTES from it). A nav entry with no
 * page under app/docs is therefore a 404 in the sidebar and a 404 published in
 * the sitemap at the same time, which is exactly the failure mode that made
 * AUDIT-014#doc-16 say "adding nav entries without the pages just ships 404s".
 */
describe("DOCS_NAV", () => {
  it("has a real page file behind every entry", () => {
    const missing = DOCS_PAGES.filter((page) => {
      const relative = page.href.replace(/^\/docs\/?/, "");
      const dir = relative
        ? join(APP_DIR, "docs", ...relative.split("/"))
        : join(APP_DIR, "docs");
      return !existsSync(join(dir, "page.tsx"));
    }).map((page) => page.href);
    expect(missing).toEqual([]);
  });
});

/**
 * app/sitemap.ts used to stamp one `new Date()` on all ~820 entries, and the
 * route is force-static, so every deploy republished the whole sitemap
 * claiming each page had changed at the same instant (AUDIT-014#seo-16).
 * Google only honours lastmod when it is consistently accurate, so that cost
 * the sitemap its freshness signal entirely.
 */
describe("sitemap lastmod", () => {
  it("gives every check page the commit date of its category source", () => {
    const missing = getAllChecks()
      .filter((check) => !CHECK_CATEGORY_LAST_MODIFIED[check.category])
      .map((check) => check.id);
    expect(missing).toEqual([]);

    const byPath = new Map(PUBLIC_ROUTES.map((r) => [r.path, r]));
    for (const check of getAllChecks()) {
      expect(byPath.get(`/checks/${check.id}`)?.lastModified).toBe(
        CHECK_CATEGORY_LAST_MODIFIED[check.category],
      );
    }
  });

  it("records a real ISO date for every check category", () => {
    for (const category of SEO_CATEGORIES) {
      const date = CHECK_CATEGORY_LAST_MODIFIED[category];
      expect(date, category).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(date).getTime()), category).toBe(false);
    }
  });

  it("emits per-source dates rather than one timestamp for everything", () => {
    const entries = sitemap();
    const stamps = new Set(
      entries.map((e) => new Date(e.lastModified as Date).toISOString()),
    );
    // The hand-listed marketing and legal pages still share the build
    // timestamp, which is honest: they change when the deploy does. What must
    // not happen again is the whole sitemap collapsing to that single value.
    expect(stamps.size).toBeGreaterThan(1);

    const checkPages = entries.filter((e) => /\/checks\/[^/]+$/.test(e.url));
    expect(checkPages.length).toBeGreaterThan(700);
    for (const entry of checkPages) {
      // Midnight UTC is what a date-only source value parses to; a build
      // timestamp never lands there.
      expect(new Date(entry.lastModified as Date).getUTCHours()).toBe(0);
    }
  });
});
