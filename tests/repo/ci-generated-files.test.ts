import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * build:knowledge writes more than lib/ai. A generated file the CI diff does
 * not cover can go stale and pass: lib/seo/check-page-ids.generated.ts was
 * added without being listed, and the unit tests only check that its
 * ASYNC_CHECK_PAGE_IDS entries are valid, so a finding could link to the wrong
 * fix guide with CI green.
 */
const ROOT = path.resolve(__dirname, "../..");
const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

const GENERATED_BY_BUILD_KNOWLEDGE = [
  "lib/ai",
  "lib/config/check-stats.generated.ts",
  "lib/seo/check-page-ids.generated.ts",
];

describe("the CI knowledge step diffs every generated file", () => {
  const diffLine = ci.match(/git diff --exit-code [^\n]+/)?.[0] ?? "";

  it("finds the diff line", () => {
    expect(diffLine).not.toBe("");
  });

  it.each(GENERATED_BY_BUILD_KNOWLEDGE)("covers %s", (file) => {
    expect(diffLine.split(/\s+/)).toContain(file);
  });
});
