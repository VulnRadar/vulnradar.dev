import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the two ways this app has broken its own hydration.
 *
 * When the server HTML and the client's first render disagree, React does not
 * patch the difference. It says so plainly: "this tree will be regenerated on
 * the client." Regenerating re-enters every route's Suspense boundary, so
 * `loading.tsx` plays a second time on top of whatever the page was already
 * showing. That is the "two skeletons" bug, and it was app-wide because the
 * cause was in the root layout.
 *
 * Both causes are cheap to detect in source, and neither is catchable by a
 * unit test that renders a component, because this vitest tier has no DOM.
 */

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.test(full)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk("app", /\.tsx$/), ...walk("components", /\.tsx$/)];

/**
 * The offending shape: a useState initializer that reaches for a query param.
 * `[^;]` keeps it inside one statement, so it cannot join two unrelated lines.
 */
const SEEDS_FROM_URL_IN_RENDER =
  /useState[^;]{0,200}?getQueryParam(Int)?\s*\(/s;

/** Comments describe the bug in prose; only code can commit it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("hydration safety", () => {
  it("finds the sources", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  /**
   * Cause 1: a pre-hydration script that inserts a node into <head>.
   *
   * app/layout.tsx used to build a <style> element from the cached session and
   * append it to document.head so signed-in chrome was right on the first
   * paint. That script runs before React hydrates, so React walked into a
   * <head> holding a node its tree did not contain and declared the markup
   * mismatched. The reveal is done with data attributes on <html> now, which
   * is safe precisely because <html> already carries suppressHydrationWarning.
   */
  it("the root layout's blocking script does not touch the document", () => {
    const src = readFileSync("app/layout.tsx", "utf8");
    const scripts = [...src.matchAll(/__html:\s*`([^`]*)`/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);

    for (const script of scripts) {
      for (const forbidden of [
        "document.head",
        "appendChild",
        "insertBefore",
        "createElement",
        "document.body",
        "innerHTML",
      ]) {
        expect(
          script,
          `The pre-hydration script in app/layout.tsx calls ${forbidden}. ` +
            `Anything it inserts is invisible to React's tree, so hydration ` +
            `fails and React regenerates the whole app on the client, which ` +
            `replays every route's loading.tsx. Set an attribute on <html> ` +
            `and put the rules in app/globals.css instead.`,
        ).not.toContain(forbidden);
      }
    }
  });

  /**
   * Cause 2: seeding state from the URL in a useState initializer.
   *
   * getQueryParam returns null without a window, so the server renders the
   * fallback and the client's first render renders the real value. That is the
   * same mismatch, reached a different way, and it is why /assets?scope=all
   * showed two skeletons while plain /assets showed one.
   *
   * useQuerySeededState (lib/ui/url-state.ts) is the fix: render the fallback
   * to match the server, then correct it in a layout effect, before paint.
   */
  it.each(SOURCES)("%s does not seed state from the URL in render", (file) => {
    const src = readFileSync(file, "utf8");
    // useState(...) whose initializer reaches for a query param, on one line
    // or wrapped across a few. Deliberately narrow: it only fires on the
    // query-param helpers, which are the ones that silently differ by
    // environment.
    const offending = SEEDS_FROM_URL_IN_RENDER.test(src);
    expect(
      offending,
      `${file} initializes state from a query param during render. The ` +
        `server has no window, so it renders the fallback and the client's ` +
        `first render disagrees, which fails hydration and makes React ` +
        `regenerate the tree (replaying loading.tsx over the page). Use ` +
        `useQuerySeededState from @/lib/ui/url-state instead.`,
    ).toBe(false);
  });

  /**
   * Cause 2, one level down.
   *
   * The rule above only ever looked at app/ and components/, and the last copy
   * of the bug was not in either: useQueryParam (lib/ui/url-state.ts) seeded
   * itself from the URL in a useState initializer, so every one of its callers
   * inherited the mismatch, /profile?tab=, /teams?team=, /repos?repo= and any
   * scan report opened with a ?sev=, ?cat= or ?q= filter already applied. A
   * shared hook is the worst place for this, because nothing in the page that
   * breaks names the cause.
   *
   * One assertion over the whole tree rather than one test per file: lib/ is
   * hundreds of modules and almost none of them touch a query string.
   */
  it("no shared module seeds state from the URL in render", () => {
    const offenders = walk("lib", /\.tsx?$/).filter((file) =>
      SEEDS_FROM_URL_IN_RENDER.test(stripComments(readFileSync(file, "utf8"))),
    );

    expect(
      offenders,
      `These shared modules initialize state from a query param during ` +
        `render, which fails hydration for every page that calls them and ` +
        `replays the route's loading.tsx over the page. Seed through ` +
        `useQuerySeededState (lib/ui/url-state.ts) instead:\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
