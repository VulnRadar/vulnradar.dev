import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_PATHS } from "@/lib/config/public-paths";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * Pins the one convention for the public surface: a page a logged-out visitor
 * can reach renders the public nav (LandingNav), whether or not the viewer
 * happens to be signed in.
 *
 * PublicPageShell used to swap in the full signed-in app Header, so /changelog,
 * /shared/[token] and the rest changed identity for a signed-in reader while
 * /docs, /legal and /checks did not. LandingNav already carries the way back
 * into the app (a Dashboard button), so the swap bought nothing and cost
 * consistency. /pricing was hand-rolled with its own copy of the chrome, which
 * is how it drifted in the first place.
 *
 * Source-text assertions on purpose: there is no DOM environment in this suite
 * (vitest.config.ts runs `node`, and jsdom is not installed), and the thing
 * worth pinning is which component the shell reaches for, which is visible in
 * the import list.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Source with comments stripped, for the assertions that a name is *gone*.
 * These files carry comments naming what was removed and why, and matching the
 * documentation would report the explanation as the defect. Block comments go
 * first, which also covers the JSX `{/* ... *\/}` form; the `[^:]` guard on the
 * line-comment pass keeps it off the `//` in a URL.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The four shells that between them cover every public route. */
const PUBLIC_SHELLS = [
  "components/shared/public-page-shell.tsx",
  "components/docs/docs-shell.tsx",
  "components/legal/legal-shell.tsx",
  "components/demo/demo-shell.tsx",
  "lib/seo/seo-ui.tsx",
];

/**
 * Public pages that render their own chrome instead of a shell.
 *
 * Empty, and it should stay empty. app/badge/page.tsx was the last one: it was
 * in PUBLIC_PATHS but rendered the signed-in app Header, so a logged-out
 * visitor following a badge link got chrome for an account they do not have.
 * That was fixed by moving it onto PublicPageShell; it has since been fixed the
 * other way round instead (see PRIVATE_APP_PAGES below), because the page is a
 * builder over the caller's own scan history and was never public in any useful
 * sense. Either resolution keeps this list empty. What must never happen again
 * is a page sitting in PUBLIC_PATHS while rendering the app header.
 */
const KNOWN_UNSHELLED_PUBLIC_PAGES: string[] = [];

/**
 * The other half of the same convention: a page that is NOT public renders the
 * signed-in app Header and never a public shell.
 *
 * /badge and /compare are the two that moved. Both read the caller's own scan
 * history and show nothing at all without a session, so both are out of
 * PUBLIC_PATHS and both carry the app header. The shell and the path list have
 * to move together, which is what the two assertions below pin: fixing only one
 * half is how /badge ended up public-with-app-chrome in the first place.
 */
const PRIVATE_APP_PAGES = ["app/badge/page.tsx", "app/compare/page.tsx"];

const APP_HEADER_IMPORT = /from\s+"@\/components\/scanner\/header"/;

/**
 * The same chrome, reached either way. A signed-in page used to import Header
 * itself; it now goes through AppPageShell, which is the single component that
 * renders that Header (plus the measured main and Footer). Matching only the
 * direct import would report the move onto the shell as a page losing its
 * chrome, which is the opposite of what happened.
 */
const APP_CHROME_IMPORT =
  /from\s+"@\/components\/(scanner\/header|shared\/app-page-shell)"/;

/** Exactly the match middleware.ts runs: exact for "/" and "/landing", prefix
 *  for everything else. */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) =>
    p === ROUTES.HOME || p === ROUTES.LANDING
      ? pathname === p
      : pathname.startsWith(p),
  );
}

/** Every app-router page file, paired with the route it serves. Route groups
 *  ("(group)") contribute no path segment; dynamic segments are left as-is,
 *  which is all prefix matching needs. */
function appPages(): { rel: string; route: string }[] {
  const out: { rel: string; route: string }[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== "page.tsx") continue;
      const segments = path
        .relative(path.join(ROOT, "app"), dir)
        .split(path.sep)
        .filter((s) => s && !s.startsWith("("));
      out.push({
        rel: path.relative(ROOT, full).split(path.sep).join("/"),
        route: "/" + segments.join("/"),
      });
    }
  }
  walk(path.join(ROOT, "app"));
  return out;
}

describe("public page shells", () => {
  it.each(PUBLIC_SHELLS)("%s renders the public nav", (rel) => {
    const source = read(rel);
    expect(source).toMatch(/from\s+"@\/components\/landing\/landing-nav"/);
    expect(source).toContain("<LandingNav");
  });

  it.each(PUBLIC_SHELLS)("%s never renders the app header", (rel) => {
    expect(read(rel)).not.toMatch(APP_HEADER_IMPORT);
  });

  it("PublicPageShell picks no nav based on auth state", () => {
    const source = code("components/shared/public-page-shell.tsx");
    // The two halves of the old swap: reading the session, and the
    // localStorage pre-read that existed only to pick a nav before /auth/me
    // resolved (and made the first client render disagree with the server).
    expect(source).not.toContain("useAuth");
    expect(source).not.toContain("vr_auth_cache");
  });

  it("LandingNav keeps a way back into the app for a signed-in reader", () => {
    const source = read("components/landing/landing-nav.tsx");
    expect(source).toContain("ROUTES.DASHBOARD");
    expect(source).toContain("Dashboard");
  });

  it("no shell overrides the nav's width, so every public top bar matches", () => {
    expect(code("components/landing/landing-nav.tsx")).not.toContain(
      "containerClass",
    );
    for (const rel of PUBLIC_SHELLS) {
      expect(code(rel)).not.toContain("containerClass");
    }
  });

  it("the pages that used to hand-roll their chrome go through a shell", () => {
    for (const rel of ["app/pricing/page.tsx", "app/changelog/page.tsx"]) {
      const source = read(rel);
      expect(source).toContain("PublicPageShell");
      expect(source).not.toMatch(APP_HEADER_IMPORT);
      expect(source).not.toContain("<LandingNav");
    }
  });

  it("no public page renders the app header instead of a shell", () => {
    // The exception list is empty, so this is now a real assertion rather
    // than a record of known debt: every public page goes through a shell.
    expect(KNOWN_UNSHELLED_PUBLIC_PAGES).toEqual([]);
    // Derived rather than hand-listed, so a page added to PUBLIC_PATHS later
    // is checked without anyone remembering to add it here.
    const offenders = appPages()
      .filter(({ route }) => isPublicPath(route))
      .filter(({ rel }) => APP_HEADER_IMPORT.test(read(rel)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the pages that are signed-in only render the app header, not a public shell", () => {
    for (const rel of PRIVATE_APP_PAGES) {
      expect(read(rel), rel).toMatch(APP_CHROME_IMPORT);
      // code(), not read(): both files carry a comment naming the shell they
      // moved off and why, and matching that would report the explanation as
      // the defect.
      expect(code(rel), rel).not.toContain("PublicPageShell");
    }
  });

  it("keeps /badge and /compare out of the public allowlist", () => {
    // The half that middleware.ts reads. Without this, the pages above could
    // keep the app header while quietly becoming reachable signed out again.
    for (const route of [ROUTES.BADGE, ROUTES.COMPARE]) {
      expect(isPublicPath(route), route).toBe(false);
    }
  });
});
