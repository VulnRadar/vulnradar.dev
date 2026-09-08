import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VALID_TABS } from "@/components/admin/nav";
import {
  HEALTH_CHECK_KEYS,
  HEALTH_ROW_COUNT,
} from "@/components/admin/features/health-overview-utils";

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

/** Every .tsx under a directory, repo-relative with forward slashes. */
function walkTsx(rel: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, rel))) {
    const next = `${rel}/${entry}`;
    if (fs.statSync(path.join(ROOT, next)).isDirectory())
      out.push(...walkTsx(next));
    else if (entry.endsWith(".tsx")) out.push(next);
  }
  return out;
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
  // /repos grew the strip last, when the account's list pages were brought
  // onto one vocabulary. It is listed here from the start so its placeholder
  // can never become the sixth hand-rolled copy.
  "components/repos/repos-skeleton.tsx",
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

  // The panel body used to be HealthCardSkeleton unconditionally. /admin picks
  // its section from ?tab=, so every deep link but Overview drew a status list
  // and then replaced it with a different section: /admin?tab=users showed
  // health rows, then a stat strip over a user table.
  it("draws the section the URL asked for rather than always Overview", () => {
    const src = code("components/admin/admin-skeleton.tsx");
    expect(src).toMatch(/AdminDataSkeleton\(\{\s*tab/);
    expect(src).toContain("ADMIN_PANEL_SHAPES[tab]");
    expect(code("app/admin/page.tsx")).toContain(
      "<AdminDataSkeleton tab={activeTab} />",
    );
  });
});

/**
 * The admin panel's per-section placeholders, checked against the sections.
 *
 * These are the numbers that go stale, so none of them is typed twice. The
 * shape table (components/admin/shared/panel-skeleton.tsx) is the one place
 * that describes a tab, and each assertion below reads the real panel's source
 * and asks whether the table still matches it.
 */
describe("every admin section reserves the shape it arrives in", () => {
  const SHAPES_SRC = code("components/admin/shared/panel-skeleton.tsx");
  const PAGE = code("app/admin/page.tsx");

  /** `key: { ... }` entries of ADMIN_PANEL_SHAPES, sliced at matching braces. */
  function shapeEntries(): Map<string, string> {
    const start = SHAPES_SRC.indexOf("ADMIN_PANEL_SHAPES");
    const body = SHAPES_SRC.slice(SHAPES_SRC.indexOf("{", start));
    const out = new Map<string, string>();
    const re = /(?:^|\n)\s{2}"?([a-z-]+)"?:\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      for (; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) break;
      }
      out.set(m[1], body.slice(m.index, i + 1));
    }
    return out;
  }

  /**
   * Which source file each tab's panel actually lives in, read off the
   * dynamic() calls in app/admin/page.tsx rather than listed here. A tab whose
   * panel moves takes its assertions with it.
   */
  function panelFiles(): Map<string, string> {
    const out = new Map<string, string>();
    const add = (tab: string, spec: string) => {
      let rel = spec.replace(/^@\//, "");
      if (!fs.existsSync(path.join(ROOT, `${rel}.tsx`))) {
        const barrel = path.join(ROOT, rel, "index.ts");
        if (!fs.existsSync(barrel)) return;
        const first = /export \* from "\.\/([\w-]+)"/.exec(
          fs.readFileSync(barrel, "utf8"),
        );
        if (!first) return;
        rel = `${rel}/${first[1]}`;
      }
      out.set(tab, `${rel}.tsx`);
    };
    for (const m of PAGE.matchAll(
      /panel\("([^"]+)",\s*\(\)\s*=>\s*import\("([^"]+)"/g,
    )) {
      add(m[1], m[2]);
    }
    // The six panels that take props keep their own dynamic() call. The
    // import specifier is the last one before the fallback names its tab.
    for (const m of PAGE.matchAll(/AdminPanelSkeleton tab="([^"]+)"/g)) {
      const spec = [
        ...PAGE.slice(0, m.index).matchAll(
          /import\("(@\/components\/admin[^"]+)"\)/g,
        ),
      ].pop();
      if (spec) add(m[1], spec[1]);
    }
    return out;
  }

  const SHAPES = shapeEntries();
  const FILES = panelFiles();

  it("has a shape for every routable destination", () => {
    // Record<AdminTabKey, PanelShape> already makes a missing key a type
    // error. This catches the other half: a key here that VALID_TABS dropped.
    expect([...SHAPES.keys()].sort()).toEqual([...VALID_TABS].sort());
  });

  it("found the panel file behind every tab", () => {
    // If this shrinks, the two assertions below stopped checking anything.
    expect(FILES.size).toBe(VALID_TABS.length);
  });

  /** Cells in each `<StatBar items={[...]} />` the panel renders, in order. */
  function realStripCells(src: string): number[] {
    const out: number[] = [];
    for (const m of src.matchAll(/<StatBar\b/g)) {
      const from = src.indexOf("items={[", m.index);
      if (from === -1) continue;
      let depth = 0;
      let i = from + "items={".length;
      for (; i < src.length; i++) {
        if (src[i] === "[") depth++;
        else if (src[i] === "]" && --depth === 0) break;
      }
      // \blabel: rather than a line-anchored match: the first cell of several
      // strips is written inline as `{ label: "Total", value: ... }`.
      out.push((src.slice(from, i).match(/\blabel:/g) ?? []).length);
    }
    return out;
  }

  /** Cells the shape reserves, in order. */
  function shapedStripCells(shape: string): number[] {
    const m = /stats:\s*(\[[^\]]*\]|\d+)/.exec(shape);
    const cells = !m
      ? []
      : m[1].startsWith("[")
        ? m[1]
            .slice(1, -1)
            .split(",")
            .map((n) => Number(n.trim()))
        : [Number(m[1])];
    // Scanner Queue is the one panel whose strip sits inside the card body
    // rather than above it, so it is a body kind rather than a `stats` count.
    // QueueBodySkeleton draws four cells; the panel renders four.
    if (/body:\s*"queue"/.test(shape)) cells.push(4);
    return cells;
  }

  it.each([...FILES.keys()])(
    "%s reserves the stat strip the panel renders",
    (tab) => {
      const src = code(FILES.get(tab)!);
      expect(shapedStripCells(SHAPES.get(tab)!)).toEqual(realStripCells(src));
    },
  );

  // A panel whose second card the placeholder never heard of grows by roughly
  // 130px of header the moment its chunk lands. Five panels stack two cards
  // and Engine Feedback stacks three; the old one-shape-fits-all fallback drew
  // one for all of them.
  const CONDITIONAL_HEADERS: Record<string, number> = {
    // The install-log card only exists while a job is running, so it is not
    // part of the shape this panel rests at.
    updater: 1,
  };

  it.each([...FILES.keys()])("%s reserves one card per panel header", (tab) => {
    const src = code(FILES.get(tab)!);
    const real =
      (src.match(/<AdminPanelHeader\b/g) ?? []).length -
      (CONDITIONAL_HEADERS[tab] ?? 0);
    const shape = SHAPES.get(tab)!;
    // A fact panel (Backups, Updater) draws its own header, as does the
    // System Health card.
    const cards = [
      ...shape.matchAll(/\{\s*(?:header|filterRows|body)[^}]*\}/g),
    ];
    const reserved =
      cards.filter((c) => !/header:\s*"(none|plain)"/.test(c[0])).length +
      (/facts:/.test(shape) ? 1 : 0);
    expect(reserved).toBe(real);
  });
});

describe("the health list reserves the rows buildHealthRows emits", () => {
  // The skeleton's own comment said eight while HealthOverview passed six, so
  // the route drew eight rows, the card redrew six, and the list arrived at
  // eight. The count is computed from the builder now.
  it("HEALTH_ROW_COUNT comes from the builder, not a literal", () => {
    const src = code("components/admin/features/health-overview-utils.ts");
    expect(src).toMatch(/HEALTH_ROW_COUNT\s*=\s*buildHealthRows\(/);
    expect(HEALTH_ROW_COUNT).toBeGreaterThan(1);
  });

  it("covers every metric guard the builder reads", () => {
    // The probe object is what makes the count right. If a check is added to
    // buildHealthRows and not to HEALTH_CHECK_KEYS, the count silently stops
    // reserving a row for it.
    const src = code("components/admin/features/health-overview-utils.ts");
    const guards = new Set(
      [...src.matchAll(/metrics\.(\w+)\s*!==\s*undefined/g)].map((m) => m[1]),
    );
    expect([...guards].sort()).toEqual([...HEALTH_CHECK_KEYS].sort());
  });

  it("neither caller of the list types its own row count", () => {
    expect(code("components/admin/features/health-overview.tsx")).not.toMatch(
      /HealthListSkeleton rows=/,
    );
    expect(code("components/admin/shared/skeleton.tsx")).toContain(
      "rows = HEALTH_ROW_COUNT",
    );
  });
});

describe("admin placeholders draw what the panel draws", () => {
  const ADMIN_FILES = walkTsx("components/admin");

  it("no table placeholder sits in a padded, bordered box", () => {
    // Eleven panels wrapped DataTableSkeleton in their own `p-4 sm:p-5` div
    // while the table that arrives is flush inside a CardContent at p-0, and
    // the skeleton drew a border the card already had. The option to do it is
    // gone, so this pins that it stays gone.
    const src = code("components/admin/shared/skeleton.tsx");
    expect(src).not.toMatch(/bordered/);
    for (const file of ADMIN_FILES) {
      expect(
        code(file),
        `${file} re-adds a bordered table placeholder`,
      ).not.toMatch(/<DataTableSkeleton[^/]*bordered/);
    }
  });

  it("the panel header placeholder stacks the way the real header does", () => {
    // AdminPanelHeader is `flex flex-col gap-3 sm:flex-row`. Side by side at
    // every width, the placeholder was one row where the real header is two on
    // a phone.
    const src = code("components/admin/shared/skeleton.tsx");
    const start = src.indexOf("export function PanelHeaderSkeleton");
    const header = src.slice(start, src.indexOf("export function", start + 1));
    expect(header).toContain("sm:flex-row");
  });

  it("nothing in the admin panel pulses through a reduced-motion setting", () => {
    // Every placeholder goes through components/ui/skeleton.tsx, which pairs
    // animate-pulse with motion-reduce:animate-none. A hand-rolled one does
    // not, and the email preview's 600px block was exactly that.
    const offenders = ADMIN_FILES.filter((file) =>
      [...code(file).matchAll(/animate-pulse/g)].some((m) => {
        const line = code(file).slice(
          code(file).lastIndexOf("\n", m.index) + 1,
          code(file).indexOf("\n", m.index),
        );
        // A live status dot is not a placeholder; a placeholder is.
        return (
          /Skeleton|skeleton|placeholder/.test(line) ||
          (/rounded|bg-muted/.test(line) && !line.includes("motion-reduce"))
        );
      }),
    );
    expect(offenders).toEqual([]);
  });

  it("every panel that draws a body placeholder names its live region", () => {
    // A screen reader was told nothing at all between clicking a section and
    // its content arriving.
    const BODY_SHAPES =
      /<(DataTable|RowList|LogList|HealthList|SettingsFields|FactPanel|QueueBody)Skeleton/;
    const unnamed = ADMIN_FILES.filter((file) => {
      if (file.includes("shared/") || file.includes("admin-skeleton"))
        return false;
      const src = code(file);
      if (!BODY_SHAPES.test(src)) return false;
      return !/SkeletonRegion|AdminPanelSkeleton/.test(src);
    });
    expect(unnamed).toEqual([]);
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
