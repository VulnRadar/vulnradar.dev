import { describe, it, expect } from "vitest";
import { pruneSelectionToVisible } from "@/components/scanner/finding-selection";

describe("pruneSelectionToVisible", () => {
  it("drops selected findings that the active filters hide", () => {
    const selected = new Set(["a", "b", "c"]);
    const next = pruneSelectionToVisible(selected, ["a", "c"]);
    expect([...next].sort()).toEqual(["a", "c"]);
  });

  it("returns the same set instance when every pick is still visible", () => {
    const selected = new Set(["a", "b"]);
    expect(pruneSelectionToVisible(selected, ["a", "b", "c"])).toBe(selected);
  });

  it("returns the same set instance when nothing is selected", () => {
    const selected = new Set<string>();
    expect(pruneSelectionToVisible(selected, [])).toBe(selected);
  });

  it("empties the selection when the filter hides everything", () => {
    const next = pruneSelectionToVisible(new Set(["a", "b"]), []);
    expect(next.size).toBe(0);
  });

  it("accepts a Set of visible ids as well as a list", () => {
    const next = pruneSelectionToVisible(
      new Set(["a", "b"]),
      new Set(["b", "z"]),
    );
    expect([...next]).toEqual(["b"]);
  });
});
