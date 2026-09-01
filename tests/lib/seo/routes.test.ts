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
  it("disallows /admin, covering /admin/ai-chats/<id> by prefix", () => {
    expect(isDisallowed("/admin")).toBe(true);
    expect(isDisallowed("/admin/ai-chats/abc")).toBe(true);
  });

  // The check that would have caught /admin, and catches the next one.
  it("covers every route that declares itself private", () => {
    const uncovered = privateLayoutPaths().filter(
      (p) =>
        // Covered outright, or covered by the trailing-slash form: /shared
        // and /browser are not routes themselves, only /shared/<token> and
        // /browser/<id>, and "/shared/" disallows every one of those.
        !isDisallowed(p) && !DISALLOWED_PATHS.includes(`${p}/`),
    );
    expect(uncovered).toEqual([]);
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
