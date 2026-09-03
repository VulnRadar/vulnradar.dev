import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Pins the loading-state invariants that keep drifting back.
 *
 * A skeleton is a picture of what actually arrives. Every one of these was a
 * live mismatch: a hand-rolled copy of a shape a shared component already
 * provides, a placeholder for a component that had since changed, or two
 * copies of the same skeleton that had already disagreed. None of them is
 * visible in a type check or a unit test of behaviour, which is exactly why
 * they kept coming back.
 *
 * Source-text assertions, same reasoning as
 * tests/components/shared/mobile-layout-invariants.test.ts: vitest.config.ts
 * runs `node`, there is no DOM and no layout engine to measure against. What
 * is worth pinning is which component a skeleton derives from, and that is
 * visible in the source.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Source with comments stripped, so a regression cannot pass on the strength
 *  of the comment that documents the bug it reintroduced. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Pages whose loading state includes the joined stat strip. All three used to
 * hand-roll a copy of it, and all three copies drew the container at
 * rounded-md with a rounded-lg icon nested inside: a child at a larger radius
 * than its own container, matching neither each other nor the rounded-xl
 * StatStrip that actually arrives. /shares was fixed first and the other two
 * were left behind for a release, which is the whole argument for the shared
 * placeholder.
 */
const STAT_STRIP_SKELETONS = [
  "components/shares/shares-skeleton.tsx",
  "components/history/history-skeleton.tsx",
  "components/assets/assets-skeleton.tsx",
  "components/scanner/dashboard.tsx",
  "components/admin/shared/skeleton.tsx",
];

describe("stat-strip placeholders come from the strip itself", () => {
  it.each(STAT_STRIP_SKELETONS)("%s imports StatStripSkeleton", (rel) => {
    expect(code(rel)).toContain("StatStripSkeleton");
  });

  it("StatStripSkeleton mirrors StatStrip's own bordered prop", () => {
    // The dashboard renders the strip unbordered inside a card. Without the
    // matching prop on the placeholder there was no way to draw that, so it
    // drew a second border the loaded state does not have.
    const src = code("components/shared/stat-strip.tsx");
    expect(src).toContain("export function StatStripSkeleton");
    const skeleton = src.slice(
      src.indexOf("export function StatStripSkeleton"),
    );
    expect(skeleton).toContain("bordered");
  });

  it.each(STAT_STRIP_SKELETONS)(
    "%s does not hand-roll a stat cell at rounded-md",
    (rel) => {
      // The exact container class every hand-rolled copy used.
      expect(code(rel)).not.toContain(
        "gap-px bg-border overflow-hidden rounded-md",
      );
    },
  );
});

describe("the scan-result body has one skeleton, not two", () => {
  // shared-scan-skeleton.tsx and history-detail-skeleton.tsx held byte-
  // identical copies of the verdict panel, the host-panel block and the
  // findings list, and had already disagreed about how many finding rows to
  // draw (4 against 5). Both compose the shared one now.
  const SHARED = "components/scanner/scan-detail-skeleton.tsx";

  it.each([
    "components/scanner/shared-scan-skeleton.tsx",
    "components/history/history-detail-skeleton.tsx",
  ])("%s composes ScanDetailSkeleton", (rel) => {
    const src = code(rel);
    expect(src).toContain("scan-detail-skeleton");
    expect(src).toContain("<ScanDetailSkeleton />");
  });

  it("neither keeps its own copy of the verdict panel", () => {
    // The grid template is the panel's signature and was the duplicated block.
    const GRID = "lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]";
    expect(code(SHARED)).toContain(GRID);
    expect(code("components/scanner/shared-scan-skeleton.tsx")).not.toContain(
      GRID,
    );
    expect(
      code("components/history/history-detail-skeleton.tsx"),
    ).not.toContain(GRID);
  });

  it("the readout strip reserves every cell ScanSummary can render", () => {
    // Risk score, SSL grade, confidence, checks run, duration, scanned. It
    // reserved three, which on a phone is one wrapped row against two.
    expect(code(SHARED)).toContain("READOUT_COUNT = 6");
  });

  it("the right column carries the divider the loaded panel has", () => {
    expect(code(SHARED)).toContain("lg:border-l");
  });
});

describe("the admin skeleton derives its nav from the real nav table", () => {
  // It used to hardcode four groups of [6, 4, 2, 4]. ADMIN_NAV_GROUPS has had
  // seven groups and 21 items for a while, so the sidebar grew by three whole
  // groups the moment the operator's role resolved.
  it("reads ADMIN_NAV_GROUPS rather than a hand-typed list", () => {
    const src = code("components/admin/admin-skeleton.tsx");
    expect(src).toContain("ADMIN_NAV_GROUPS");
    expect(src).not.toMatch(/\[6,\s*4,\s*2,\s*4\]/);
  });
});

describe("there is one Skeleton primitive", () => {
  // components/admin/shared/skeleton.tsx declared a second one whose default
  // radius was `rounded` against the app-wide `rounded-md`, so every admin
  // placeholder sat a rung below every other placeholder in the product.
  it("the admin barrel re-exports the ui primitive instead of redefining it", () => {
    const src = code("components/admin/shared/skeleton.tsx");
    expect(src).toContain('from "@/components/ui/skeleton"');
    expect(src).not.toMatch(/export function Skeleton\s*\(/);
  });
});

describe("the pricing skeleton renders the page's own static sections", () => {
  // Hand-drawn versions of the comparison table, the FAQ and the closing CTA
  // left the placeholder roughly 2,000px shorter than the page, so the footer
  // painted mid-viewport and the whole document jumped on hydration. Those
  // three sections take no data, so the skeleton renders the real ones.
  it("uses PricingFeatures, PricingFaq and PricingCta", () => {
    const src = code("components/pricing/pricing-skeleton.tsx");
    expect(src).toContain("<PricingFeatures />");
    expect(src).toContain("<PricingFaq />");
    expect(src).toContain("<PricingCta");
  });

  it("uses PublicPageShell rather than a copy of LandingNav", () => {
    const src = code("components/pricing/pricing-skeleton.tsx");
    expect(src).toContain("PublicPageShell");
    expect(src).not.toContain("--vr-banner-h");
  });
});

describe("route skeletons carry the skip link's target", () => {
  // The root layout's skip link points at #main-content. A loading.tsx renders
  // INSTEAD of the page, so without the id on the skeleton's own <main> the
  // link had nothing to jump to for the whole load.
  //
  // Written out by hand is no longer the only way to satisfy that: AppPageShell
  // owns the <main> for every signed-in page and sets both the id and the
  // tabIndex on it, so a skeleton that goes through the shell inherits the
  // target rather than declaring a second one. Insisting on the literal here
  // would push these files back into hand-copying the chrome, which is the
  // drift tests/components/skeleton-drift.test.ts exists to stop.
  const ROUTE_SKELETONS = [
    "components/admin/admin-skeleton.tsx",
    "components/dashboard/dashboard-skeleton.tsx",
    "components/history/history-skeleton.tsx",
    "components/shares/shares-skeleton.tsx",
    "components/assets/assets-skeleton.tsx",
    "components/profile/profile-skeleton.tsx",
    "components/repos/repos-skeleton.tsx",
  ];

  it.each(ROUTE_SKELETONS)("%s sets id=main-content and tabIndex", (rel) => {
    const src = code(rel);
    if (src.includes("AppPageShell")) {
      expect(src).toContain("<AppPageShell");
      return;
    }
    expect(src).toContain('id="main-content"');
    expect(src).toContain("tabIndex={-1}");
  });

  // ...and the shell they now delegate to has to keep holding it, which is the
  // half of the invariant that would otherwise be assumed rather than checked.
  it("AppPageShell is where that target now lives", () => {
    const src = code("components/shared/app-page-shell.tsx");
    expect(src).toContain('id="main-content"');
    expect(src).toContain("tabIndex={-1}");
  });
});
