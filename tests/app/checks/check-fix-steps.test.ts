import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The fix steps on every /checks/<id> page (about 750 of them) were numbered
 * circles beside the text. CLAUDE.md asks for "numbered lists that read like
 * prose (not circle badges)" and DocsSteps already draws a procedure that way
 * in the docs, so the two now share one shape.
 *
 * Source-text assertions: the suite has no DOM, and this page is an async
 * server component that vitest cannot transform under `jsx: preserve`.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stepsBlock(): string {
  const page = code("app/checks/[id]/page.tsx");
  const start = page.indexOf('aria-labelledby="fix"');
  const end = page.indexOf("</section>", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return page.slice(start, end);
}

describe("check page fix steps", () => {
  it("are an ordered list", () => {
    expect(stepsBlock()).toContain("<ol");
  });

  it("draw the number as text on the step's line, not as a badge", () => {
    const block = stepsBlock();
    expect(block).toContain("{i + 1}.");
    expect(block).not.toContain("rounded-full");
    expect(block).not.toContain("bg-primary/10");
    expect(block).not.toMatch(/\bh-6 w-6\b/);
  });

  it("hide the visible numeral, since the <ol> already announces the order", () => {
    expect(stepsBlock()).toMatch(
      /<span\s+aria-hidden="true"\s+className="[^"]*text-primary[^"]*tabular-nums[^"]*"\s*>\s*\{i \+ 1\}\./,
    );
  });

  it("use the same numeral recipe as DocsSteps", () => {
    const docs = code("components/docs/docs-steps.tsx");
    for (const token of [
      "shrink-0",
      "font-semibold",
      "text-primary",
      "tabular-nums",
    ]) {
      expect(docs).toContain(token);
      expect(stepsBlock()).toContain(token);
    }
  });
});
