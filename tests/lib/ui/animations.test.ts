import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { toggles } from "@/lib/ui/animations";

/**
 * lib/ui/animations.ts is static Tailwind class-string configuration with no
 * branching, so asserting its values back at themselves would be hollow. The
 * one thing here that can actually break silently is whether those class
 * strings survive Tailwind's extractor, and that is what this file tests.
 *
 * It used to also cover a `cn` and a `getStaggerDelay` exported from that
 * module. Both are gone, and neither was reachable from the product:
 *
 *   `cn` was a second cn - a plain `.filter(Boolean).join(" ")` with no
 *   class-conflict resolution - sitting beside the clsx + tailwind-merge one
 *   in lib/ui/utils.ts that STYLE.md names as the import convention. Every
 *   call site in the app used the real one. A same-named helper that silently
 *   does less is worse than no helper.
 *
 *   `getStaggerDelay` returned `[animation-delay:Nms]` as a standalone
 *   arbitrary-property class. components/shared/response-readout.tsx
 *   documents at length why that exact shape does not work: Tailwind does not
 *   preserve source order between arbitrary-property utilities, and the
 *   `animation` shorthand resets animation-delay for every sub-property it
 *   does not list, which collapsed a staggered list to 0ms. That file now
 *   ships pre-combined static classes instead. So the helper was not merely
 *   unused, it was a working implementation of a bug someone had already
 *   fixed, kept alive by this test alone.
 */

/**
 * The one assertion about a class string in this file that is not hollow.
 *
 * tailwind.config.mjs deliberately does not list lib/ in `content`, so a
 * Tailwind class whose only appearance in the repo is inside lib/ui/
 * animations.ts generates no CSS at all: no build error, no warning, just a
 * control that silently does nothing. That has already shipped once, as three
 * staff role badges with no colour, which is why the config carries a warning
 * comment about it.
 *
 * Tailwind extracts candidates token by token rather than by whole class
 * string, so a recipe here is safe exactly as long as each of its tokens also
 * appears somewhere under a scanned directory. This walks components/ and app/
 * and proves that for `toggles`, whose whole job is to be imported from lib
 * into components. If someone deletes the last literal use of a token, this
 * fails instead of the toggle quietly losing its animation.
 */
const SCANNED_ROOTS = ["components", "app"];
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function readScannedSources(): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) {
          continue;
        }
        walk(full);
      } else if (/\.(tsx?|jsx?|mdx)$/.test(entry.name)) {
        chunks.push(readFileSync(full, "utf8"));
      }
    }
  };
  for (const root of SCANNED_ROOTS) walk(path.join(REPO_ROOT, root));
  return chunks.join("\n");
}

/**
 * The second, equally valid way to make a lib-only class real: list it in the
 * `@source inline(...)` safelist in app/globals.css. The walk above only reads
 * .ts/.tsx/.mdx, so it never sees that file, and without this a recipe that
 * correctly safelists its own tokens would still fail. Both `duration-100` and
 * `motion-reduce:transition-none` are safelisted for exactly that reason: their
 * only literal uses under components/ are incidental (a progress bar, a
 * collapsible caret) and deleting either would otherwise strip the transition
 * off every toggle in the product.
 */
function readSafelistedClasses(): Set<string> {
  const css = readFileSync(path.join(REPO_ROOT, "app", "globals.css"), "utf8");
  const classes = new Set<string>();
  for (const match of css.matchAll(/@source\s+inline\("([^"]*)"\)/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token) classes.add(token);
    }
  }
  return classes;
}

describe("toggles recipe stays inside Tailwind's content globs", () => {
  const sources = readScannedSources();
  const safelisted = readSafelistedClasses();

  const tokens = [
    ...new Set(Object.values(toggles).flatMap((recipe) => recipe.split(/\s+/))),
  ].filter(Boolean);

  it("names at least one token per recipe", () => {
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("finds a non-empty @source inline safelist to check against", () => {
    expect(safelisted.size).toBeGreaterThan(0);
  });

  it.each(tokens)(
    "%s appears literally under components/ or app/, or is safelisted",
    (token) => {
      expect(sources.includes(token) || safelisted.has(token)).toBe(true);
    },
  );
});
