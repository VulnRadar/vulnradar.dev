import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The docs shell stacks four things under the public nav: the drawer and the
 * sticky bar that opens it (below xl) and the two sticky rails (sidebar and
 * on-page contents, from lg and xl). They used to be positioned against the
 * top of the viewport,
 * and the nav above them is not: it is sticky at the banner offsets
 * (--vr-banner-h from the site notice, --vr-imp-banner-h from the staff
 * impersonation banner) and 56px tall.
 *
 * Source-text assertions on purpose, same reasoning as
 * tests/components/shared/mobile-layout-invariants.test.ts: the suite runs
 * under `node` with no DOM and no layout engine, so what can be pinned is the
 * class contract.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const BANNERS = "var(--vr-banner-h,0px)+var(--vr-imp-banner-h,0px)";
const BANNERS_SUBTRACTED = "var(--vr-banner-h,0px)-var(--vr-imp-banner-h,0px)";

describe("docs mobile drawer starts below the public nav", () => {
  const src = code("components/docs/docs-mobile-nav.tsx");
  // The panel is the element that carries the drawer's id; the bar above it
  // in the file is also pinned to the nav, so match on the id.
  const drawerClass =
    src.match(/id="docs-mobile-nav"[\s\S]*?className="([^"]*)"/)?.[1] ?? "";

  it("finds the drawer panel at all", () => {
    expect(drawerClass).toContain("xl:hidden");
  });

  it("hangs off the nav's height plus both banner offsets", () => {
    expect(drawerClass).toContain(`top-[calc(3.5rem+${BANNERS})]`);
  });

  it("is no longer inset-0, which put the close chip under the nav", () => {
    expect(drawerClass).toContain("bottom-0");
    expect(drawerClass).toContain("inset-x-0");
    expect(drawerClass).not.toMatch(/\binset-0\b/);
  });

  it("stays under the nav in the stack", () => {
    // The nav is z-50. The drawer sitting at or above it would cover the nav's
    // own menu button, which is the other control a phone user needs.
    expect(drawerClass).toContain("z-40");
    expect(code("components/landing/landing-nav.tsx")).toContain("z-50");
  });

  it("uses the nav's own height, so the two cannot drift apart", () => {
    // h-14 is 3.5rem. If the nav bar changes height this fails and the drawer
    // offset has to be changed with it.
    expect(code("components/landing/landing-nav.tsx")).toContain("h-14");
  });

  it("keeps its tabs clear of its own close chip", () => {
    // The chip is absolute at top-3 right-3 inside the drawer, in the corner
    // the tab row runs into.
    expect(src).toContain("pl-4 pr-14");
  });

  it("clears the cookie notice at the bottom of the list", () => {
    expect(src).toContain("pb-[calc(1.5rem+var(--vr-cookie-h,0px))]");
  });
});

describe("docs sticky bar", () => {
  const src = code("components/docs/docs-mobile-nav.tsx");
  const barClass = src.match(/"sticky top-\[calc\(3\.5rem[^"]*"/)?.[0] ?? "";

  it("is found", () => {
    expect(barClass).not.toBe("");
  });

  it("sticks under the nav and both banners, in flow", () => {
    expect(barClass).toContain(`top-[calc(3.5rem+${BANNERS})]`);
    expect(barClass).not.toMatch(/\bfixed\b/);
  });

  it("is 44px tall and has both controls at that height", () => {
    expect(barClass).toContain("h-11");
    expect(barClass).toContain("items-stretch");
  });

  it("sits under the drawer and the nav in the stack", () => {
    expect(barClass).toContain("z-30");
  });

  it("stands aside once the rail exists", () => {
    expect(src).toContain('tocItems.length > 0 ? "xl:hidden" : "lg:hidden"');
  });

  it("replaced the floating pill", () => {
    expect(src).not.toContain("DocsMobileNavTrigger");
    expect(src).not.toContain("bottom-[calc(5rem");
  });

  it("is why anchored headings land lower below xl", () => {
    // 3.5rem nav + 2.75rem bar = 100px; the root's scroll-padding is 64px, so
    // a heading needs 36px more to clear it, and scroll-mt-12 gives 48.
    expect(code("components/docs/docs-prose.ts")).toContain(
      "scroll-mt-12 xl:scroll-mt-4",
    );
  });
});

describe.each([
  ["components/docs/docs-sidebar.tsx", "sidebar"],
  ["components/docs/docs-toc.tsx", "contents rail"],
])("%s (%s) sticks below the nav and the banners", (rel) => {
  const src = code(rel);

  it("adds both banner heights to its top", () => {
    expect(src).toContain(`top-[calc(4rem+${BANNERS})]`);
    expect(src).not.toMatch(/\bsticky top-16\b/);
  });

  it("takes both banner heights off its height, so the bottom stays in view", () => {
    expect(src).toContain(`h-[calc(100vh-4rem-${BANNERS_SUBTRACTED})]`);
    expect(src).not.toContain("h-[calc(100vh-4rem)]");
  });
});

describe("the nav the docs shell sits under reads the same two variables", () => {
  it("landing-nav.tsx offsets by both", () => {
    const src = code("components/landing/landing-nav.tsx");
    expect(src).toContain("--vr-banner-h");
    expect(src).toContain("--vr-imp-banner-h");
  });
});
