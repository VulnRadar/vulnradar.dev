import { describe, it, expect } from "vitest";
import { filterScannableFiles } from "@/lib/github/repo-filter";
import type { GithubTreeEntry } from "@/lib/github/github-api";

function blob(path: string, size: number): GithubTreeEntry {
  return { path, type: "blob", sha: `sha-${path}`, size };
}

const DEFAULT_CAPS = {
  maxFiles: 300,
  maxTotalBytes: 5_000_000,
  maxFileBytes: 300_000,
};

describe("filterScannableFiles", () => {
  it("keeps ordinary source files", () => {
    const entries = [blob("src/index.ts", 100), blob("README.md", 200)];
    const result = filterScannableFiles(entries, DEFAULT_CAPS);
    expect(result.selected.map((e) => e.path)).toEqual([
      "src/index.ts",
      "README.md",
    ]);
    expect(result.truncatedByCaps).toBe(false);
  });

  it("skips files inside vendor/build directories", () => {
    const entries = [
      blob("node_modules/lodash/index.js", 100),
      blob("dist/bundle.js", 100),
      blob(".git/HEAD", 10),
      blob("src/app.ts", 100),
    ];
    const result = filterScannableFiles(entries, DEFAULT_CAPS);
    expect(result.selected.map((e) => e.path)).toEqual(["src/app.ts"]);
  });

  it("skips binary-looking extensions", () => {
    const entries = [blob("logo.png", 100), blob("app.py", 100)];
    const result = filterScannableFiles(entries, DEFAULT_CAPS);
    expect(result.selected.map((e) => e.path)).toEqual(["app.py"]);
  });

  it("ignores tree entries (directories), only ever considers blobs", () => {
    const entries: GithubTreeEntry[] = [
      { path: "src", type: "tree", sha: "t1" },
      blob("src/app.ts", 100),
    ];
    const result = filterScannableFiles(entries, DEFAULT_CAPS);
    expect(result.selected.map((e) => e.path)).toEqual(["src/app.ts"]);
    expect(result.totalBlobCount).toBe(1);
  });

  it("skips a single file over the per-file byte cap", () => {
    const entries = [blob("huge.ts", 500_000), blob("small.ts", 100)];
    const result = filterScannableFiles(entries, {
      ...DEFAULT_CAPS,
      maxFileBytes: 300_000,
    });
    expect(result.selected.map((e) => e.path)).toEqual(["small.ts"]);
  });

  it("stops once the max file count is reached and reports truncation", () => {
    const entries = Array.from({ length: 5 }, (_, i) => blob(`f${i}.ts`, 10));
    const result = filterScannableFiles(entries, {
      ...DEFAULT_CAPS,
      maxFiles: 3,
    });
    expect(result.selected).toHaveLength(3);
    expect(result.truncatedByCaps).toBe(true);
  });

  it("respects the total byte budget, skipping files that would exceed it but keeping later smaller ones", () => {
    const entries = [blob("a.ts", 4000), blob("b.ts", 4000), blob("c.ts", 100)];
    const result = filterScannableFiles(entries, {
      ...DEFAULT_CAPS,
      maxTotalBytes: 4100,
    });
    // a.ts fits (4000), b.ts would push to 8000 (over budget) so it's skipped,
    // c.ts (100) still fits under the remaining budget.
    expect(result.selected.map((e) => e.path)).toEqual(["a.ts", "c.ts"]);
    expect(result.truncatedByCaps).toBe(true);
  });
});
