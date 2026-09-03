import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Catches prose glued to an interpolation across a line break.
 *
 * JSX discards the newline and indentation between an expression container and
 * the text that follows it. So this:
 *
 *     It is scoped to {APP_NAME}
 *     only: it answers questions about scan findings...
 *
 * renders as "VulnRadaronly". It shipped on /docs/ai and a reader spotted it
 * before any test did, which is the whole problem: it is invisible in the
 * source, where the two words sit on separate lines with a line break between
 * them that looks exactly like a space.
 *
 * Prettier causes it. It reflows a long paragraph and can land a break right
 * after an interpolation, silently turning correct output into glued output
 * with no edit to the words themselves. The fix is the explicit `{" "}` this
 * codebase already uses in dozens of places.
 *
 * Deliberately narrow: only a bare identifier interpolation (`{APP_NAME}`,
 * `{count}`) followed by a line opening with a word. A complex expression is
 * usually a conditional element rather than an inline value, and flex `gap`
 * handles the spacing there, so including those produced only false positives.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SOURCES = [...walk("app"), ...walk("components")];

/** A line whose last thing is a plain `{identifier}` or `{a.b}`. */
const ENDS_WITH_BARE_INTERPOLATION = /\{[A-Za-z_$][\w$.]*\}$/;

/** The next line starts a word, so JSX will butt it against the value above. */
const STARTS_WITH_WORD = /^[A-Za-z]/;

describe("no prose glued to an interpolation", () => {
  it("finds the sources", () => {
    expect(SOURCES.length).toBeGreaterThan(50);
  });

  it.each(SOURCES)("%s keeps a space before continuing prose", (file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const hits: string[] = [];

    for (let i = 0; i < lines.length - 1; i++) {
      const a = lines[i].trim();
      const b = lines[i + 1].trim();
      if (!a || !b) continue;
      if (/^(\/\/|\/\*|\*|\{\/\*)/.test(a)) continue;
      // An attribute (`title={x}`) is inside a tag, never adjacent to prose.
      if (/^[A-Za-z_][\w-]*=["'{]/.test(a)) continue;
      if (/^[A-Za-z_][\w-]*=["'{]/.test(b)) continue;

      if (!ENDS_WITH_BARE_INTERPOLATION.test(a)) continue;
      if (!STARTS_WITH_WORD.test(b)) continue;
      // A line opening a call or member access is code, not prose.
      if (/^[\w.]+[({]/.test(b)) continue;

      hits.push(`${i + 1}: ${a.slice(-52)}  ||  ${b.slice(0, 52)}`);
    }

    expect(
      hits,
      `${file} continues a sentence on the line after an interpolation. JSX ` +
        `drops that line break, so the value and the next word render joined ` +
        `("VulnRadaronly"). End the first line with {" "}:\n` +
        hits.map((h) => `  ${h}`).join("\n"),
    ).toEqual([]);
  });
});
