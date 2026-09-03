/**
 * One modal grammar, enforced.
 *
 * Before components/ui/modal-grammar.ts, the product shipped four incompatible
 * modal shells and they drifted for the same reason every time: a call site
 * restated the panel's own chrome in its `className`, and the next modal copied
 * a different set of numbers. `p-0 gap-0 flex flex-col max-h-[85vh]
 * overflow-hidden`, `rounded-xl`, `border-0`, `shadow-2xl`, `bg-black/60` and
 * four spellings of the same width were all live at once.
 *
 * These tests read the source rather than rendering it on purpose: the failure
 * mode is not a broken component, it is a correct component with the grammar
 * copy-pasted around it. Nothing here checks that a modal looks right; they
 * check that the modal is not carrying its own opinion about what a modal is.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["components", "app"];

/** Files that legitimately define the grammar rather than consume it. */
const GRAMMAR_OWNERS = [
  "components/ui/modal-grammar.ts",
  "components/ui/modal-shell.tsx",
  "components/ui/dialog.tsx",
  "components/ui/alert-dialog.tsx",
  "components/ui/sheet.tsx",
  "components/ui/command.tsx",
];

/**
 * Not yet migrated, and the only one.
 *
 * Empty, and it should stay empty. It briefly held
 * components/teams/team-create-dialog.tsx, which another workstream was
 * editing while the grammar landed; that has since moved to `size="md"`.
 * Nothing else belongs here: a modal that needs a width off the ladder passes
 * an unprefixed `max-w-*`, which overrides the rung cleanly, so there is never
 * a reason to reach for a `sm:` width again.
 */
const PENDING_MIGRATION: string[] = [];

function sourceFiles(): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".tsx") && !entry.endsWith(".ts")) continue;
      out.push({
        path: relative(ROOT, full).split(sep).join("/"),
        source: readFileSync(full, "utf8"),
      });
    }
  }
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir));
  return out;
}

const FILES = sourceFiles();

/** The className string of every `<XContent ...>` opening tag in a file. */
function contentClassNames(source: string): string[] {
  const found: string[] = [];
  const tag = /<(?:Dialog|AlertDialog|Sheet)Content\b([\s\S]*?)(?:\/>|>)/g;
  for (const match of source.matchAll(tag)) {
    for (const cls of match[1].matchAll(
      /className=(?:"([^"]*)"|\{([\s\S]*?)\})/g,
    )) {
      found.push(cls[1] ?? cls[2] ?? "");
    }
  }
  return found;
}

describe("modal panels do not restate the grammar", () => {
  /**
   * Each of these was actually in the tree, on a modal, before this pass. They
   * are banned on a *panel* only: the same class on a card or a control inside
   * the modal body is fine and common.
   */
  const BANNED: [RegExp, string][] = [
    [/\bp-0\b/, 'the shell tier already removes padding (variant="shell")'],
    [/\bgap-0\b/, "the shell tier already removes the grid gap"],
    [/\brounded-(?:xl|2xl|none)\b/, "a modal is rounded-lg (radius ladder)"],
    [/\bborder-0\b/, "a modal panel keeps its --border edge"],
    [/\bborder-input\b/, "a panel edge is --border, not the control token"],
    [/\bborder-border\/\d+\b/, "the panel edge is a bare `border`"],
    [/\bbg-card\b/, "modalPanel already sets the surface"],
    [/\bshadow-(?:2xl|xl|md|sm|none)\b/, "modalPanel sets shadow-lg"],
    [/\bmax-h-\[/, "modalPanel owns the max-height (dvh aware)"],
    [/\boverflow-y-auto\b/, "the body band scrolls, not the panel"],
    [/\bsm:max-w-/, "use the `size` prop; a sm: width outranks an override"],
  ];

  it.each(BANNED)("no modal panel sets %s", (pattern, why) => {
    const offenders: string[] = [];
    for (const { path, source } of FILES) {
      if (GRAMMAR_OWNERS.includes(path)) continue;
      if (PENDING_MIGRATION.includes(path)) continue;
      for (const cls of contentClassNames(source)) {
        if (pattern.test(cls)) offenders.push(`${path}: "${cls}"`);
      }
    }
    expect(offenders, `${why}\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("modal scrims are theme-correct", () => {
  it("uses no bg-black scrim anywhere", () => {
    // --background is `213 25% 90%` in the light theme, so a bg-black/60 scrim
    // dimmed the page to near black in dark mode and washed it to near white in
    // light mode. Opening one of each in sequence read as a rendering bug, and
    // seven hand-rolled admin overlays did exactly that.
    const offenders = FILES.filter(({ source }) =>
      /className=[^\n]*\bfixed inset-0[^\n]*\bbg-black\//.test(source),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("the modal grammar stays in one place", () => {
  it("keeps the panel, scrim and bands in modal-grammar.ts", async () => {
    const grammar = await import("@/components/ui/modal-grammar");
    // A bare `border`, deliberately: SC 1.4.11 governs the boundary of a
    // control you operate, not the edge of the container it sits in. Using
    // --input here is what put a hard outline around every modal in the
    // product, and it was reversed. If somebody puts it back, this fails.
    expect(grammar.modalPanel).toContain(" border ");
    expect(grammar.modalPanel).not.toContain("border-input");
    expect(grammar.modalPanel).toContain("bg-card");
    expect(grammar.modalPanel).toContain("rounded-lg");
    // The internal scrolling body is why nine modals stopped clipping their
    // own footers on a short viewport. Both halves have to stay.
    expect(grammar.modalPanel).toMatch(/max-h-\[calc\(100dvh/);
    expect(grammar.modalBand.body).toContain("overflow-y-auto");
    expect(grammar.modalBand.body).toContain("flex-1");
    expect(grammar.modalScrim).toContain("bg-background/80");
  });
});
