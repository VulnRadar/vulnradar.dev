/**
 * Tests for lib/scanner/finding-diff.ts, the diff primitive shared by
 * app/api/v3/compare/route.ts (keyed on title) and
 * lib/scanner/regression-alert.ts (keyed on Vulnerability.id).
 */
import { describe, it, expect } from "vitest";
import { diffFindingsByKey } from "@/lib/scanner/finding-diff";

describe("diffFindingsByKey", () => {
  it("classifies added, removed, and unchanged items by the given key", () => {
    const before = [{ key: "a" }, { key: "b" }];
    const after = [{ key: "b" }, { key: "c" }];

    const { added, removed, unchanged } = diffFindingsByKey(
      before,
      after,
      (item) => item.key,
    );

    expect(added).toEqual([{ key: "c" }]);
    expect(removed).toEqual([{ key: "a" }]);
    expect(unchanged).toEqual([{ key: "b" }]);
  });

  it("treats every item as added when `before` is empty (first scan ever)", () => {
    const after = [{ key: "a" }, { key: "b" }];
    const { added, removed, unchanged } = diffFindingsByKey(
      [],
      after,
      (item) => item.key,
    );

    expect(added).toEqual(after);
    expect(removed).toEqual([]);
    expect(unchanged).toEqual([]);
  });

  it("treats every item as removed when `after` is empty", () => {
    const before = [{ key: "a" }, { key: "b" }];
    const { added, removed, unchanged } = diffFindingsByKey(
      before,
      [],
      (item) => item.key,
    );

    expect(added).toEqual([]);
    expect(removed).toEqual(before);
    expect(unchanged).toEqual([]);
  });

  it("returns the `after` copy for unchanged items, not the `before` copy", () => {
    // Same key, different payload -- unchanged should reflect the *current*
    // scan's version of the finding, not the stale one.
    const before = [{ key: "a", severity: "high" }];
    const after = [{ key: "a", severity: "critical" }];

    const { unchanged } = diffFindingsByKey(before, after, (item) => item.key);

    expect(unchanged).toEqual([{ key: "a", severity: "critical" }]);
  });
});
