import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The footer and the landing check table, as a class contract. Source-text
 * assertions, for the reason mobile-layout-invariants.test.ts gives (vitest
 * runs `node`, so there is no layout engine to ask).
 *
 *  - The footer ran on a wider measure than the nav and every public page
 *    above it, so on a wide screen its wordmark started about 56px to the left
 *    of the nav's, and it stacked 22 links in one column on a phone.
 *  - The landing table's category links were 20px anchors in 44px rows, the
 *    exact trap STYLE.md's target-size section describes.
 */
const ROOT = path.resolve(__dirname, "../../..");

/** Source with comments stripped, so prose about a class cannot satisfy it. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the footer", () => {
  const src = code("components/scanner/footer.tsx");

  it("uses the measure of the nav and every public page above it", () => {
    expect(src).toContain('"max-w-6xl mx-auto px-4 sm:px-6 py-16"');
    expect(src).not.toContain("max-w-7xl");
    expect(src).not.toContain("lg:px-8");
  });

  it("runs two link columns below md, with the brand block across both", () => {
    expect(src).toMatch(/grid grid-cols-2 md:grid-cols-5/);
    expect(src).not.toContain("grid-cols-1 md:grid-cols-5");
    expect(src).toContain('<div className="col-span-2">');
  });

  it("credits the host from config, as a followed link in the server HTML", () => {
    // From HOSTING_PROVIDER, so a self-hosted deployment that changes or
    // blanks the config does not keep vulnradar.dev's host in its footer.
    expect(src).toContain("const host = HOSTING_PROVIDER;");
    expect(src).toContain("{host && (");
    expect(src).toContain("href={host.url}");
    expect(src).not.toMatch(/wslatl/i);
    // The point of the credit is the link, so nothing may demote it.
    expect(src).not.toMatch(/nofollow|ugc/);
    expect(src).not.toMatch(/^["']use client["']/m);
  });
});

describe("the landing check table", () => {
  it("pads its category links to the 24px target floor", () => {
    const src = code("components/landing/landing-categories.tsx");
    // The row link and the "Browse every check" link, each with the padding
    // on the anchor and the margin pulled back so the layout does not move.
    expect(src).toContain("-my-1.5 block w-fit py-1.5");
    expect(src).toContain("-mt-0.5 -mb-1.5 inline-block py-1.5");
  });
});
