import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * No tracked source file carries an ASCII control character other than tab,
 * newline and carriage return.
 *
 * The case that produced this: a scripted edit wrote `\b` through a layer of
 * string escaping and it landed as the backspace character U+0008. Inside a
 * regex literal that is not a word boundary, it is a character no input
 * contains, so `expect(sql).not.toMatch(/<BS>JOIN<BS>/i)` could never fail
 * and a detector's pattern silently stopped matching real code. Nothing else
 * notices: the file compiles, lints and looks correct in most editors.
 */
const SOURCE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|css|md|yml|yaml)$/;

describe("source files", () => {
  it("contain no stray control characters", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => SOURCE.test(f));
    const offenders: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // eslint-disable-next-line no-control-regex -- finding them is the point
        const m = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.exec(lines[i]);
        if (m) {
          const code = m[0].charCodeAt(0).toString(16).padStart(4, "0");
          offenders.push(`${file}:${i + 1} U+${code}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
