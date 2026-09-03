import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The guard that replaces re-making skeletons by hand.
 *
 * Skeletons drifted for one reason: eleven of them hand-copied the chrome of
 * the page they stood in for. Header, the min-h-screen column, the measured
 * main, Footer, all written out a second time, with nothing checking the two
 * copies still agreed. They stopped agreeing. /assets grew a HistoryViewTabs
 * strip its skeleton never heard about, so the tab bar appeared on load and
 * pushed everything down; /repos and /credits accumulated six and eight
 * container widths each against a page that has one.
 *
 * You cannot test "does this look right". You can test that the second copy
 * does not exist, which is the thing that made looking wrong possible. A
 * skeleton describes the region that is waiting for data. Chrome is not
 * waiting for data, so a skeleton that renders chrome is the bug, and this
 * fails on it by name.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Several of these files discuss dynamic() in prose. Only code counts. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every `dynamic(...)` call in a file, sliced at its matching close paren.
 * Import specifiers are the only parens inside these calls and they never
 * contain one of their own, so counting depth is enough.
 */
function dynamicCalls(source: string): string[] {
  const src = stripComments(source);
  const out: string[] = [];
  const re = /\bdynamic\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(src)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    out.push(src.slice(match.index, i + 1));
  }
  return out;
}

const SKELETONS = walk("components").filter((f) =>
  /skeleton/i.test(f.split(/[\\/]/).pop() ?? ""),
);

// components/ui/skeleton.tsx is the shimmer primitive itself and
// components/shared/skeleton-shapes.tsx is the shape library. Neither stands
// in for a page, so neither is subject to the chrome rule.
const PRIMITIVES = ["ui", "shared"];
const PAGE_SKELETONS = SKELETONS.filter((f) => {
  const parts = f.split(/[\\/]/);
  return !PRIMITIVES.includes(parts[1] ?? "");
});

describe("skeleton drift guard", () => {
  it("finds the skeleton files", () => {
    expect(PAGE_SKELETONS.length).toBeGreaterThan(5);
  });

  it.each(PAGE_SKELETONS)("%s does not re-implement page chrome", (file) => {
    const src = readFileSync(file, "utf8");

    // Header and Footer need no data and so must never be inside a skeleton:
    // rendering them here means the page threw away a real navigation bar it
    // already had in order to draw a grey box where it used to be. Put the
    // skeleton inside AppPageShell instead and the chrome stays mounted.
    expect(
      src,
      `${file} imports the app Header/Footer. Chrome does not wait for data: ` +
        `render this skeleton inside <AppPageShell> and drop the chrome from ` +
        `this file. See components/shared/app-page-shell.tsx.`,
    ).not.toMatch(/from "@\/components\/scanner\/(header|footer)"/);

    // A measured container is the page's decision, made once, in the page.
    // A copy here is what silently disagrees when the page's width changes.
    expect(
      src,
      `${file} declares its own max-w container. The width belongs to the ` +
        `page's AppPageShell, not to its placeholder.`,
    ).not.toMatch(/max-w-\d?xl mx-auto/);

    // min-h-screen means "I am the whole page". A skeleton is a region.
    expect(
      src,
      `${file} claims the full viewport (min-h-screen). A skeleton fills the ` +
        `data region inside the shell, it does not replace the page.`,
    ).not.toMatch(/min-h-screen/);
  });

  /**
   * The last cause of a skeleton playing twice, and the one no amount of care
   * with the skeletons themselves could have prevented.
   *
   * next/dynamic only wraps its lazy component in a Suspense boundary when it
   * is given a `loading` option or `ssr: false`
   * (`hasSuspenseBoundary = !opts.ssr || !!opts.loading`, see
   * next/dist/shared/lib/lazy-dynamic/loadable.js). A bare
   * `dynamic(() => import(...))` renders a Fragment instead, so the chunk
   * suspends the nearest ANCESTOR boundary, which on any route with a
   * loading.tsx is the route itself. ScanResultDetail's threat-intel and
   * software panels did exactly that, so a finished scan report on
   * /history?scan=X was covered by the /history LIST skeleton the moment the
   * report rendered, roughly 700ms in, for as long as those two chunks took.
   *
   * `loading: () => null` is the right fallback for a panel that means to draw
   * nothing; what is not optional is having a boundary at all.
   */
  it.each(
    [...walk("app"), ...walk("components")].filter(
      (f) => dynamicCalls(readFileSync(f, "utf8")).length > 0,
    ),
  )("%s gives every dynamic() its own suspense boundary", (file) => {
    const src = readFileSync(file, "utf8");
    const offenders = dynamicCalls(src).filter(
      (call) => !/\bloading\s*:/.test(call) && !/\bssr\s*:\s*false/.test(call),
    );

    expect(
      offenders,
      `${file} calls dynamic() with neither a \`loading\` option nor ` +
        `\`ssr: false\`, so next/dynamic gives it no Suspense boundary and the ` +
        `chunk suspends the route's loading.tsx instead: the page replays its ` +
        `whole route skeleton over content that had already arrived. Pass ` +
        `\`{ loading: () => null }\` if the intent really is to draw nothing.\n` +
        offenders.map((c) => `  ${c.split("\n")[0]}...`).join("\n"),
    ).toEqual([]);
  });

  /**
   * A loading.tsx is the fallback for its own segment and for every descendant
   * segment that does not declare one. That is how /teams/join (an invitation
   * card on the auth shell) came to draw the teams list, /checkout/success (a
   * confirmation) came to draw a payment form, and an admin AI transcript came
   * to draw the admin console: three routes whose route transition promised a
   * page the reader was never going to.
   *
   * The rule is not "every page needs a loading.tsx". It is that a page
   * inheriting one must actually look like it.
   */
  it("no page inherits a loading.tsx drawn for a different layout", () => {
    const norm = (f: string) => f.split(/[\\/]/).join("/");
    const segments = (kind: string) =>
      walk("app")
        .filter((f) => f.endsWith(`${kind}.tsx`))
        .map((f) => norm(f).replace(new RegExp(`/${kind}\\.tsx$`), ""));

    const loadings = segments("loading");
    const own = new Set(loadings);

    // The one page that shares a parent's fallback on purpose:
    // components/billing/checkout-skeleton.tsx is written for this route and
    // says so, and /checkout has no page of its own to own it.
    const SHARED_ON_PURPOSE = new Set(["app/checkout/[productId]"]);

    const offenders: string[] = [];
    for (const page of segments("page")) {
      if (own.has(page) || SHARED_ON_PURPOSE.has(page)) continue;
      const inherited = loadings.find((l) => page.startsWith(`${l}/`));
      if (inherited)
        offenders.push(`${page} inherits ${inherited}/loading.tsx`);
    }

    expect(
      offenders,
      `These routes have no fallback of their own and borrow an ancestor's, ` +
        `which draws a different page. Add a loading.tsx to the segment, or ` +
        `add it to SHARED_ON_PURPOSE if the borrowed one genuinely matches:\n` +
        offenders.map((o) => `  - ${o}`).join("\n"),
    ).toEqual([]);
  });

  /**
   * The reveal rule, as far as reading source can check it.
   *
   * These pages each have a data region fed by more than one request, and each
   * used to swap out of its skeleton on the first one to land: /history grew a
   * fourth filter control after the list had drawn, /teams grew an invitations
   * panel above a list that had already settled. They join their requests now
   * and reveal once.
   *
   * This asserts the join is still there, not that it still gates the right
   * thing, which needs a DOM this tier does not have. It is a tripwire for
   * someone splitting a coordinated reveal back apart, not a proof.
   */
  it.each([
    "app/history/page.tsx",
    "app/teams/page.tsx",
    "app/profile/page.tsx",
    "app/host/[hostname]/page.tsx",
  ])("%s joins its independent requests before revealing", (file) => {
    expect(
      readFileSync(file, "utf8"),
      `${file} feeds one visible region from several requests and no longer ` +
        `joins them. Revealing on the first one to land makes the reader watch ` +
        `the page assemble itself in stages. Await them together ` +
        `(Promise.allSettled, so one dead endpoint cannot hang the region) and ` +
        `clear the loading flag after.`,
    ).toMatch(/Promise\.(allSettled|all)\(/);
  });

  it("no page swaps its entire body for a skeleton", () => {
    const pages = walk("app").filter((f) => f.endsWith("page.tsx"));
    const offenders: string[] = [];

    for (const file of pages) {
      const src = readFileSync(file, "utf8");
      // `if (loading) return <XSkeleton />` as the page's own early return is
      // the pattern that discards chrome. Matching the return statement
      // rather than the JSX keeps this from firing on a skeleton legitimately
      // rendered for one region further down the tree.
      const m = src.match(
        /if\s*\([^)]*\)\s*\{?\s*return\s*<\s*[A-Z]\w*Skeleton\b/,
      );
      if (m) offenders.push(file);
    }

    expect(
      offenders,
      `These pages replace themselves with a skeleton, so their header, tabs ` +
        `and filters disappear while loading and pop back in afterwards. Keep ` +
        `the shell mounted and swap only the waiting region:\n` +
        `  <AppPageShell>{chrome}{loading ? <DataSkeleton/> : <Data/>}</AppPageShell>\n` +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
