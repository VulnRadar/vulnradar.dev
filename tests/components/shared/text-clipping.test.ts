import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Text whose line box is shorter than its glyphs.
 *
 * The report was "the bottom of the g is cut off", on the shared report's URL
 * heading. `truncate` is overflow: hidden, which clips to the line box, and
 * the box was 1.1x the font size because app/globals.css applied
 * `leading-[1.1]` to every h1. A `leading-*` utility sets the --tw-leading
 * variable and every `text-*` utility reads its line-height through that
 * variable, so the base rule overrode the size class the heading carried.
 *
 * Source-text assertions, same reasoning as leading-icon.test.ts: vitest runs
 * in node, there is no layout engine, and the contract is visible in source.
 */

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const TSX = [
  ...walk(path.join(ROOT, "components")),
  ...walk(path.join(ROOT, "app")),
];

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");
const lineOf = (src: string, index: number) =>
  src.slice(0, index).split("\n").length;

describe("text clipping", () => {
  it("base heading and paragraph rules do not apply leading or size utilities", () => {
    const css = fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8");
    const offenders: string[] = [];
    for (const m of css.matchAll(/^\s*(h[1-6]|p)\s*\{([^}]*)\}/gm)) {
      if (
        /@apply[^;]*\b(?:leading-|text-(?:xs|sm|base|lg|[0-9]?xl))/.test(m[2])
      ) {
        offenders.push(m[1]);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("nothing that clips its overflow sets a line box shorter than its type", () => {
    // leading-none is 1, leading-3/4 are 12px/16px absolutes, and anything in
    // brackets below 1.2 is the same mistake spelled differently. All of them
    // are fine on text that can overflow its box, and all of them cut
    // descenders off text that cannot.
    const TIGHT =
      /^(?:[\w-]+:)*leading-(?:none|3|4|\[(?:0?\.\d+|1(?:\.[01]\d*)?)\])$/;
    const CLIP =
      /^(?:[\w-]+:)*(?:truncate|line-clamp-\d+|overflow-hidden|overflow-clip)$/;
    const offenders: string[] = [];

    /**
     * Every class token in one string literal, plus every token in one cn()
     * call taken together.
     *
     * A cn() call composes several literals into ONE class attribute, so its
     * pieces have to be judged as one. components/shared/stat-strip.tsx put
     * `truncate` in one argument and the leading in another, a dozen lines
     * apart, and shipped a 24px line box around 28px of glyphs on every stat
     * in the product straight past the literal-by-literal check.
     */
    function* classGroups(
      src: string,
    ): Generator<{ tokens: string[]; at: number }> {
      const LITERAL = /"([^"\n]*)"|`([^`]*)`/g;
      for (const m of src.matchAll(LITERAL)) {
        yield { tokens: (m[1] ?? m[2]).split(/\s+/), at: m.index ?? 0 };
      }
      for (const call of src.matchAll(/\bcn\(/g)) {
        const open = call.index ?? 0;
        let depth = 0;
        let close = -1;
        for (let i = open + 3; i < src.length; i++) {
          const ch = src[i];
          if (ch === "(") depth++;
          else if (ch === ")") {
            if (depth === 0) {
              close = i;
              break;
            }
            depth--;
          }
        }
        if (close < 0) continue;
        const tokens: string[] = [];
        for (const lit of src.slice(open, close).matchAll(LITERAL)) {
          tokens.push(...(lit[1] ?? lit[2]).split(/\s+/));
        }
        yield { tokens, at: open };
      }
    }

    for (const file of TSX) {
      const src = fs.readFileSync(file, "utf8");
      for (const group of classGroups(src)) {
        if (
          group.tokens.some((t) => TIGHT.test(t)) &&
          group.tokens.some((t) => CLIP.test(t))
        ) {
          offenders.push(`${rel(file)}:${lineOf(src, group.at)}`);
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
