import { describe, it, expect } from "vitest";
import {
  CHANGE_CATEGORIES,
  CHANGE_CATEGORY_ORDER as CATEGORY_ORDER,
  CHANGELOG,
} from "@/lib/changelog/data";

/**
 * The renderer walks CATEGORY_ORDER to group a release. A category that exists
 * in CHANGE_CATEGORIES but is missing from the order does not fail to compile:
 * the two Record maps beside it are checked by TypeScript, the array is not,
 * so the entries simply fall into an "Other" group at the bottom. That is how
 * a new section added for a release would quietly disappear from it.
 */
describe("changelog category order", () => {
  it("lists every category exactly once", () => {
    const declared = Object.keys(CHANGE_CATEGORIES).sort();
    expect([...CATEGORY_ORDER].sort()).toEqual(declared);
    expect(new Set(CATEGORY_ORDER).size).toBe(CATEGORY_ORDER.length);
  });

  it("puts breaking changes first, so they are never below the fold", () => {
    expect(CATEGORY_ORDER[0]).toBe("breaking");
  });

  it("gives every change in every release a known category or none", () => {
    const known = new Set(Object.keys(CHANGE_CATEGORIES));
    const unknown = CHANGELOG.flatMap((r) =>
      r.changes
        .filter((c) => c.category !== undefined && !known.has(c.category))
        .map((c) => `${r.version}: ${c.label} (${c.category})`),
    );
    expect(unknown).toEqual([]);
  });
});
