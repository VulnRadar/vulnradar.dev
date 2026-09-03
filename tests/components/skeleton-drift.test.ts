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
