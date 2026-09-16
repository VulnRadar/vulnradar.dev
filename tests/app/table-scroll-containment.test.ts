import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A table's sr-only caption is absolutely positioned. Inside a scroll
 * wrapper that is not itself positioned, the caption's containing block is
 * the page, so it escapes the wrapper's overflow clip and counts toward the
 * page's width. On /pricing at 320px that made the layout viewport 530px
 * wide: the page rendered zoomed and the fixed cookie notice ran off the
 * right edge of the screen. The shared Table primitive already wraps its
 * table in `relative w-full overflow-auto`; four hand-written wrappers did
 * not.
 */
function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const WRAPPER_CLASSES = /["'`][^"'`]*\boverflow-x-auto\b[^"'`]*["'`]/g;

describe("tables with a visually hidden caption", () => {
  const files = ["app", "components"]
    .flatMap((dir) => tsxFiles(dir))
    .filter((f) =>
      readFileSync(f, "utf8").includes('<caption className="sr-only"'),
    );

  it("finds the tables it guards", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  for (const file of files) {
    const name = file.split("\\").join("/");
    it(`${name} positions every scroll wrapper`, () => {
      const source = readFileSync(file, "utf8");
      const wrappers = [...source.matchAll(WRAPPER_CLASSES)].map((m) => m[0]);
      expect(wrappers.length).toBeGreaterThan(0);
      for (const classes of wrappers) {
        expect(classes, `${classes} needs "relative"`).toMatch(/\brelative\b/);
      }
    });
  }
});
