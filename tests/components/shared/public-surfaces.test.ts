import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The class contract for the public marketing surface: /pricing and /demo.
 * Source-text assertions, for the reason
 * mobile-layout-invariants.test.ts gives (vitest runs `node`, so there is no
 * layout engine to ask).
 *
 * What is pinned is what drifted:
 *
 *  - /pricing and /demo separated their sections with `border-t` hairlines and
 *    an ad-hoc `bg-muted/30` wash, where the landing page uses the three
 *    tile-* surfaces. STYLE.md says the rhythm comes from a change of surface.
 *    bg-muted/30 is not a step on that ladder, so it also did not re-pitch
 *    between the themes the way tile-contrast does.
 *  - The same closing call to action was square on /pricing and /demo and a
 *    pill on the landing page.
 *  - The comparison table lost its row labels when it scrolled sideways on a
 *    phone, which left bare numbers.
 *
 * The footer has its own file, public-footer.test.ts.
 */
const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so prose about a class cannot satisfy it. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The className on the first <section> in a file. */
function sectionClass(rel: string): string {
  const match = code(rel).match(/<section\b([^>]*)>/);
  if (!match) throw new Error(`no <section> in ${rel}`);
  const cls = match[1].match(/className="([^"]*)"/);
  return cls ? cls[1] : "";
}

/** The tile a file's first section sits on. No class means the page surface. */
function tileOf(rel: string): string {
  return sectionClass(rel).match(/tile-(alt|contrast|base)/)?.[1] ?? "base";
}

const SECTIONS = {
  "components/pricing/pricing-hero.tsx": "",
  "components/pricing/pricing-faq.tsx": "",
  "components/pricing/pricing-features.tsx": "tile-alt",
  "components/pricing/pricing-cta.tsx": "tile-contrast",
  "components/demo/demo-info.tsx": "tile-alt",
  "components/demo/demo-cta.tsx": "tile-contrast",
} as const;

describe("pricing and demo sections change surface instead of drawing a rule", () => {
  it.each(Object.entries(SECTIONS))("%s", (rel, tile) => {
    const cls = sectionClass(rel);
    if (tile) expect(cls).toContain(tile);
    else expect(cls).not.toMatch(/\btile-(?:alt|contrast)\b/);
    expect(cls).not.toMatch(/\bborder-[tb]\b/);
    expect(cls).not.toMatch(/\bbg-muted\b/);
  });

  it("never sets a section on the surface of the one above it", () => {
    // The step is the divider, so two neighbours on the same step have none.
    // /pricing: hero and rail (one unit, the page surface), table, FAQ, CTA.
    // /demo: hero, why-we-let-you-scan-us, CTA.
    const chains = [
      [
        "components/pricing/pricing-hero.tsx",
        "components/pricing/pricing-features.tsx",
        "components/pricing/pricing-faq.tsx",
        "components/pricing/pricing-cta.tsx",
      ],
      [
        "components/demo/demo-hero.tsx",
        "components/demo/demo-info.tsx",
        "components/demo/demo-cta.tsx",
      ],
    ];
    for (const chain of chains) {
      const tiles = chain.map(tileOf);
      for (let i = 1; i < tiles.length; i++) {
        expect(tiles[i], `${chain[i]} after ${chain[i - 1]}`).not.toBe(
          tiles[i - 1],
        );
      }
    }
  });
});

describe("closing calls to action are pills", () => {
  it.each([
    "components/pricing/pricing-cta.tsx",
    "components/demo/demo-cta.tsx",
    "components/demo/demo-results-header.tsx",
    "components/landing/landing-cta.tsx",
    "components/landing/landing-hero.tsx",
  ])("%s", (rel) => {
    const src = code(rel);
    const buttons = src.match(/<Button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `${rel}: ${button}`).toContain('shape="pill"');
    }
  });
});

describe("the closing call to action's buttons take their width from the row", () => {
  // The three bands put their buttons in `flex flex-col sm:flex-row
  // lg:flex-col`. Column direction already stretches them to one width. With
  // the old Link wrapper a `w-full` on the Button was harmless, because it
  // resolved against a shrink-to-fit anchor. On a Button asChild the class is
  // on the anchor that IS the flex item, so in the sm row two `width: 100%`
  // items split the whole band between them: 348px and 350px buttons on a
  // 768px tablet, measured, where the natural widths are 167px and 139px.
  it.each([
    "components/pricing/pricing-cta.tsx",
    "components/demo/demo-cta.tsx",
    "components/landing/landing-cta.tsx",
  ])("%s", (rel) => {
    const buttons = code(rel).match(/<Button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button, `${rel}: ${button}`).not.toMatch(/\bw-full\b/);
    }
  });
});

describe("the plan comparison table keeps its row labels in view on a phone", () => {
  const src = code("components/pricing/pricing-features.tsx");

  it("pins the label column below sm, painted by the row it belongs to", () => {
    expect(src).toContain("max-sm:sticky max-sm:left-0");
    expect(src).toContain("max-sm:bg-inherit");
    // Both the "Limit" header and every row header take it.
    expect(src.match(/STICKY_LABEL,/g)).toHaveLength(2);
  });

  it("paints every row opaque, since a sticky cell inherits what the row paints", () => {
    // An alpha tint on a row would be inherited by the sticky cell, and the
    // numbers scrolling underneath would show through the label.
    expect(src).not.toMatch(/\bbg-muted\/\d+/);
    expect(src).not.toMatch(/hover:bg-muted\/\d+/);
    expect(src).toContain("bg-card transition-colors");
  });

  it("makes the scroller reachable from the keyboard, with a visible focus ring", () => {
    expect(src).toContain("tabIndex={0}");
    expect(src).toContain("overflow-x-auto");
    expect(src).toContain("focus-visible:ring-2");
    expect(src).toContain('role="region"');
  });

  it("gives the label column less room on a phone than on a desktop", () => {
    expect(src).toContain("w-36 sm:w-[40%]");
  });
});
