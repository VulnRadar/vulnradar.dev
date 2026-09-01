import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cn, getStaggerDelay, toggles } from "@/lib/ui/animations";

/**
 * Most of lib/ui/animations.ts (durations, easings, transitions, hovers,
 * focus, animations, interactive, backdrops, effects, stagger) is static
 * Tailwind class-string configuration with no branching or computation -
 * testing those would just assert string literals back at themselves, so
 * they're skipped as hollow. cn() and getStaggerDelay() are the only two
 * exports with actual logic, and are covered below.
 *
 * Note: this file also exports a `cn` helper, distinct from the
 * clsx + tailwind-merge `cn` in lib/ui/utils.ts referenced by
 * CLAUDE.md's import conventions. This one is a plain
 * `.filter(Boolean).join(" ")`, with no class-conflict resolution.
 */

describe("cn", () => {
  it("joins truthy class strings with a space", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters out false and undefined", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });

  it("returns an empty string when given nothing truthy", () => {
    expect(cn(false, undefined)).toBe("");
    expect(cn()).toBe("");
  });

  it("filters out an empty-string class the same as other falsy input", () => {
    expect(cn("a", "", "b")).toBe("a b");
  });
});

describe("getStaggerDelay", () => {
  it("multiplies index by the default 50ms base delay", () => {
    expect(getStaggerDelay(0)).toBe("[animation-delay:0ms]");
    expect(getStaggerDelay(1)).toBe("[animation-delay:50ms]");
    expect(getStaggerDelay(3)).toBe("[animation-delay:150ms]");
  });

  it("honors a custom base delay", () => {
    expect(getStaggerDelay(2, 100)).toBe("[animation-delay:200ms]");
    expect(getStaggerDelay(0, 100)).toBe("[animation-delay:0ms]");
  });
});

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
