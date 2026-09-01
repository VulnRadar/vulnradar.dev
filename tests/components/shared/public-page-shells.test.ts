import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

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
 * Public pages that render their own chrome rather than going through a shell.
 * Kept short on purpose: every entry here is a place the convention has to be
 * re-checked by hand.
 *
 * app/badge/page.tsx is the known outlier. ROUTES.BADGE is in PUBLIC_PATHS
 * (lib/config/public-paths.ts) and the page imports the app Header directly, so
 * a logged-out visitor gets the signed-in chrome on a public page. It is listed
 * rather than fixed because it was outside the boundary of the change that
 * added this test; move it onto PublicPageShell and delete this entry.
 */
/**
 * Public pages that render their own chrome instead of a shell.
 *
 * Empty, and it should stay empty. app/badge/page.tsx was the last one: it is
 * in PUBLIC_PATHS but rendered the signed-in app Header, so a logged-out
 * visitor following a badge link got chrome for an account they do not have.
 */
const KNOWN_UNSHELLED_PUBLIC_PAGES: string[] = [];

const APP_HEADER_IMPORT = /from\s+"@\/components\/scanner\/header"/;

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
    expect(read("app/badge/page.tsx")).not.toMatch(APP_HEADER_IMPORT);
    expect(read("app/badge/page.tsx")).toContain("PublicPageShell");
  });
});
