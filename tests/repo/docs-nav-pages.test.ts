import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { DOCS_NAV, DOCS_PAGES } from "@/components/docs/docs-nav";
import { DOCS_REDIRECTS } from "@/lib/docs/redirects";
import { MOVED_ANCHORS } from "@/lib/docs/moved-anchors";

/**
 * The docs set is described by one registry, and everything else (the sidebar,
 * the sitemap, llms.txt, the in-app links, the AI knowledge) points into it.
 * These are the invariants that keep the pointers true while pages move: a
 * dead /docs link compiles exactly like a live one.
 */

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...walk(rel, match));
    } else if (match(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function routeOfPage(rel: string): string {
  return rel.replace(/^app/, "").replace(/\/page\.tsx$/, "");
}

const PAGE_FILES = walk("app/docs", (name) => name === "page.tsx");
const ROUTES_ON_DISK = new Set(PAGE_FILES.map(routeOfPage));
const REDIRECT_SOURCES = new Set(DOCS_REDIRECTS.map((row) => row.source));

/**
 * The renames of spec 1.3 that land on the pages before the navigation
 * switches: until then a page's H1 may equal either its nav label or the name
 * below. The switch sets the labels and deletes this map.
 */
const PENDING_H1_RENAMES: Record<string, string> = {
  "/docs/cli": "Command-line interface (CLI)",
  "/docs/github": "Scanning a GitHub repo",
  "/docs/account-security": "Account and sign-in",
  "/docs/sharing": "Sharing and public pages",
  "/docs/reports": "Reports and exports",
  "/docs/triage": "Fixing and tracking findings",
};

/** The H1 /docs/cli carries until its rename lands. Goes with the map above. */
const H1_BEFORE_RENAME: Record<string, string> = {
  "/docs/cli": "Command-Line Interface",
};

/** The page's own local array duplicates the ids, so it cannot be the proof. */
function withoutLocalToc(source: string): string {
  return source.replace(/const (?:tocItems|TOC)\b[^=]*=\s*\[[\s\S]*?\n\];/, "");
}

function pageSource(route: string): string {
  return withoutLocalToc(read(`app${route}/page.tsx`));
}

function hasAnchor(source: string, id: string): boolean {
  return (
    source.includes(`id="${id}"`) ||
    source.includes(`id: "${id}"`) ||
    source.includes(`id={"${id}"}`) ||
    // DocsHero's id defaults to "overview" when the page does not set one.
    (id === "overview" && /<DocsHero\b(?![^>]*\bid=)/.test(source))
  );
}

/** "/docs/teams#roles" names a page that exists and a section it has. */
function targetExists(href: string): boolean {
  const [route, hash] = href.split("#");
  if (!ROUTES_ON_DISK.has(route)) return false;
  return !hash || hasAnchor(pageSource(route), hash);
}

describe("every registry entry has a page", () => {
  it.each(DOCS_PAGES.map((page) => page.href))("%s", (href) => {
    expect(
      existsSync(path.join(ROOT, `app${href}/page.tsx`)),
      `${href} is in DOCS_NAV but has no page.tsx`,
    ).toBe(true);
  });

  it("names each page's file in source", () => {
    for (const page of DOCS_PAGES) {
      expect(existsSync(path.join(ROOT, page.source))).toBe(true);
      expect(routeOfPage(page.source)).toBe(page.href);
    }
  });
});

describe("every page is in the registry or a redirect", () => {
  const known = new Set(DOCS_PAGES.map((page) => page.href));

  it.each([...ROUTES_ON_DISK])("%s", (route) => {
    expect(
      known.has(route) || REDIRECT_SOURCES.has(route),
      `${route} is on disk but not in DOCS_NAV or DOCS_REDIRECTS`,
    ).toBe(true);
  });
});

describe("every /docs link resolves", () => {
  // A docs URL at the start of a string, an href or a sentence. The lookbehind
  // skips file paths (app/docs/x, components/docs/x, ../docs/x) and other
  // sites' documentation (nextjs.org/docs/x).
  const DOCS_LINK = /(?<![\w./@-])\/docs((?:\/[a-z0-9-]+)+)/g;

  const files = [
    ...["app", "components", "lib"].flatMap((dir) =>
      walk(dir, (name) => /\.(ts|tsx)$/.test(name)),
    ),
    ...walk("lib/ai", (name) => name.endsWith("-knowledge.md")),
  ];

  /**
   * Pages a constant already names, ahead of the wave that builds them. Delete
   * a row when its page lands; a new row here is a link to nowhere.
   */
  const NOT_BUILT_YET = new Set(["/docs/api/migrate-v4"]);

  const resolvable = new Set([
    ...ROUTES_ON_DISK,
    ...REDIRECT_SOURCES,
    ...DOCS_PAGES.map((page) => page.href),
    ...NOT_BUILT_YET,
  ]);

  /** Comments mention paths as examples ("/docs/x"); only code links anywhere. */
  function withoutComments(file: string): string {
    if (file.endsWith(".md")) return read(file);
    return read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  it("has files to read", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds no dead link", () => {
    const dead: string[] = [];
    for (const file of files) {
      for (const match of withoutComments(file).matchAll(DOCS_LINK)) {
        const href = `/docs${match[1]}`;
        if (!resolvable.has(href)) dead.push(`${file}: ${href}`);
      }
    }
    expect([...new Set(dead)]).toEqual([]);
  });
});

describe("every table of contents matches its page", () => {
  it.each(
    DOCS_PAGES.filter((page) => page.toc.length > 0).map((p) => [p.href, p]),
  )("%s", (_href, page) => {
    const source = pageSource(page.href);
    const missing = page.toc
      .map((entry) => entry.id)
      .filter((id) => !hasAnchor(source, id));
    expect(missing, `${page.href} has no element with these ids`).toEqual([]);
  });

  it("has no duplicate entries within a page", () => {
    for (const page of DOCS_PAGES) {
      const ids = page.toc.map((entry) => entry.id);
      expect(new Set(ids).size, page.href).toBe(ids.length);
    }
  });

  it("derives no subsection id that another element on the page already has", () => {
    // DocsSubSection slugs its title when it is given no id, so two "Request"
    // headings on one page would be one link target.
    const slug = (title: string) =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    const collisions: string[] = [];
    for (const file of PAGE_FILES) {
      const source = read(file);
      const seen = new Set(
        [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
      );
      for (const match of source.matchAll(
        /<DocsSubSection\s+title="([^"]+)"/g,
      )) {
        const id = slug(match[1]);
        if (seen.has(id)) collisions.push(`${file}: ${id}`);
        seen.add(id);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("gives every section a unique id", () => {
    const sections = DOCS_NAV.map((section) => section.id);
    expect(new Set(sections).size).toBe(sections.length);
  });
});

describe("every moved anchor lands somewhere", () => {
  it("each row's source page and target exist", () => {
    for (const [from, rows] of Object.entries(MOVED_ANCHORS)) {
      expect(ROUTES_ON_DISK.has(from), `${from} is not a page`).toBe(true);
      for (const [hash, target] of Object.entries(rows)) {
        expect(targetExists(target), `${from}#${hash} -> ${target}`).toBe(true);
      }
    }
  });

  it("can tell a real target from a dead one", () => {
    expect(targetExists("/docs/teams#roles")).toBe(true);
    expect(targetExists("/docs/teams#no-such-section")).toBe(false);
    expect(targetExists("/docs/no-such-page#roles")).toBe(false);
  });
});

describe("nav labels equal page titles", () => {
  it("lists exactly the six pending renames", () => {
    expect(Object.keys(PENDING_H1_RENAMES).sort()).toEqual(
      [
        "/docs/account-security",
        "/docs/cli",
        "/docs/github",
        "/docs/reports",
        "/docs/sharing",
        "/docs/triage",
      ].sort(),
    );
  });

  const pages = DOCS_PAGES.filter((page) => page.href !== "/docs");

  it.each(pages.map((page) => [page.href, page]))("%s", (href, page) => {
    const title = read(page.source).match(/<DocsHero[\s\S]*?title="([^"]+)"/);
    expect(title, `${href} has no literal DocsHero title`).not.toBeNull();
    const accepted = [
      page.label,
      PENDING_H1_RENAMES[href as string],
      H1_BEFORE_RENAME[href as string],
    ].filter(Boolean);
    expect(accepted).toContain(title![1]);
  });
});
