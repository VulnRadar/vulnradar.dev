import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * No emoji or geometric-shape characters standing in for icons in the UI.
 *
 * This keeps coming back, so it gets a test. The last one was `&#9654;` as the
 * disclosure marker on the changelog's "Show N more" control: U+25B6 has emoji
 * presentation by default on Windows and on most phones, so what the source
 * called a small triangle rendered as a full-colour blue emoji beside text set
 * in the UI font. The source gives no hint either, since `&#9654;` reads as a
 * geometric shape rather than as a picture.
 *
 * The project uses lucide-react everywhere else. An icon component inherits
 * currentColor, scales with the type, matches the size of its neighbours, and
 * can be hidden from assistive tech properly. A character cannot do any of
 * that, because the font decides how it is drawn.
 *
 * Two rules, deliberately narrow so it stays worth keeping:
 *
 *  1. A numeric HTML entity (`&#9654;` or `&#x25B6;`) for anything in the
 *     symbol ranges. Nobody reaches for an entity except to draw a glyph, and
 *     writing it that way is exactly how the last one got past review.
 *
 *  2. A literal emoji from the pictographic planes.
 *
 * Literal arrows and box-drawing characters are NOT flagged. The docs pages
 * legitimately use them for ASCII diagrams and prose (`config-values.ts <-
 * SOURCE OF TRUTH`, request-flow diagrams), which is typography, not an icon.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCES = [...walk("app"), ...walk("components")];

/** Pictographic emoji, plus the variation selector that forces emoji drawing. */
const LITERAL_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{FE0F}]/u;

/** Symbol ranges that, written as an entity, mean "draw me a glyph". */
const ENTITY_GLYPH_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2190, 0x21ff], // arrows
  [0x2300, 0x23ff], // technical (media control symbols)
  [0x25a0, 0x25ff], // geometric shapes, where the changelog triangle lived
  [0x2600, 0x27bf], // misc symbols and dingbats
  [0x2b00, 0x2bff], // misc symbols and arrows
  [0x1f000, 0x1faff], // emoji
];

function entityCodepoint(raw: string): number {
  return raw.startsWith("&#x")
    ? parseInt(raw.slice(3, -1), 16)
    : parseInt(raw.slice(2, -1), 10);
}

describe("no emoji standing in for icons", () => {
  it("finds the sources", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it.each(SOURCES)("%s uses icon components, not glyph characters", (file) => {
    const src = readFileSync(file, "utf8");
    const hits: string[] = [];

    for (const [i, line] of src.split("\n").entries()) {
      // Comments are prose about the code and may name a character on purpose
      // (this file's own docblock does).
      const code = line.replace(/\/\/.*$/, "").trim();
      if (!code || code.startsWith("*") || code.startsWith("/*")) continue;

      // U+FE0E is the text variation selector: it is the author saying, in
      // the encoding itself, "draw this as a glyph and not as a picture".
      // That is the documented fix for a character with an emoji form, so a
      // character carrying it is not what this test is looking for. See the
      // warn mark in components/shared/response-readout.tsx.
      if (LITERAL_EMOJI.test(code.replace(/.︎/gu, ""))) {
        hits.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
      }
      for (const entity of code.match(/&#x?[0-9a-fA-F]+;/g) ?? []) {
        const cp = entityCodepoint(entity);
        if (!Number.isFinite(cp)) continue;
        if (ENTITY_GLYPH_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) {
          hits.push(`${i + 1}: ${entity} in ${line.trim().slice(0, 60)}`);
        }
      }
    }

    expect(
      hits,
      `${file} draws a glyph character where an icon belongs. A character is ` +
        `styled by whatever font resolves it, so it renders in colour and at ` +
        `the wrong size beside real icons. Use a lucide-react component:\n` +
        hits.map((h) => `  ${h}`).join("\n"),
    ).toEqual([]);
  });
});
