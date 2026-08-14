import { describe, it, expect } from "vitest";
import {
  toggleSelection,
  toggleAllSelection,
  pruneSelection,
  selectionSummary,
  bulkActionDialogCopy,
  summarizeBulkOutcome,
  type PendingBulkAction,
  type BulkItemResult,
} from "@/components/admin/users/bulk-actions-toolbar-utils";

/**
 * These test the pure reducer/formatter functions pulled out of
 * bulk-actions-toolbar.tsx, not the React component itself -- this
 * project's Vitest runs in a plain node environment with no jsdom, so a
 * JSX-rendering test isn't possible here (see
 * components/admin/shared/use-unsaved-changes-warning.ts's test for the
 * same pattern applied elsewhere in this codebase).
 */

describe("toggleSelection", () => {
  it("adds an id that isn't selected", () => {
    const result = toggleSelection(new Set([1, 2]), 3);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it("removes an id that is already selected", () => {
    const result = toggleSelection(new Set([1, 2, 3]), 2);
    expect(result).toEqual(new Set([1, 3]));
  });

  it("does not mutate the input set", () => {
    const original = new Set([1]);
    toggleSelection(original, 2);
    expect(original).toEqual(new Set([1]));
  });
});

describe("toggleAllSelection", () => {
  it("selects every id on the page when none of them are selected", () => {
    const result = toggleAllSelection(new Set(), [1, 2, 3]);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it("selects every id on the page when only some are selected", () => {
    const result = toggleAllSelection(new Set([2]), [1, 2, 3]);
    expect(result).toEqual(new Set([1, 2, 3]));
  });

  it("deselects the page's ids once every one of them is already selected", () => {
    const result = toggleAllSelection(new Set([1, 2, 3]), [1, 2, 3]);
    expect(result).toEqual(new Set());
  });

  it("leaves a selection outside the current page untouched when deselecting", () => {
    const result = toggleAllSelection(new Set([1, 2, 99]), [1, 2]);
    expect(result).toEqual(new Set([99]));
  });

  it("no-ops on an empty page", () => {
    const selected = new Set([1, 2]);
    const result = toggleAllSelection(selected, []);
    expect(result).toEqual(new Set([1, 2]));
  });
});

describe("pruneSelection", () => {
  it("drops selected ids no longer present on the page", () => {
    const result = pruneSelection(new Set([1, 2, 3]), [2, 3]);
    expect(result).toEqual(new Set([2, 3]));
  });

  it("returns the same Set instance when nothing changed", () => {
    const selected = new Set([1, 2]);
    const result = pruneSelection(selected, [1, 2, 3]);
    expect(result).toBe(selected);
  });

  it("returns the same (empty) instance when the selection is already empty", () => {
    const selected = new Set<number>();
    const result = pruneSelection(selected, [1, 2]);
    expect(result).toBe(selected);
  });

  it("drops everything when the page has no ids in common", () => {
    const result = pruneSelection(new Set([1, 2]), [3, 4]);
    expect(result).toEqual(new Set());
  });
});

describe("selectionSummary", () => {
  it("reports allSelected when every id on the page is selected", () => {
    const summary = selectionSummary(new Set([1, 2]), [1, 2]);
    expect(summary.allSelected).toBe(true);
    expect(summary.someSelected).toBe(false);
    expect(summary.selectedIds.sort()).toEqual([1, 2]);
  });

  it("reports someSelected for a partial match", () => {
    const summary = selectionSummary(new Set([1]), [1, 2]);
    expect(summary.allSelected).toBe(false);
    expect(summary.someSelected).toBe(true);
  });

  it("reports neither flag for an empty page", () => {
    const summary = selectionSummary(new Set(), []);
    expect(summary.allSelected).toBe(false);
    expect(summary.someSelected).toBe(false);
  });

  it("a selection extending beyond the current page still counts toward allSelected for the page's own ids", () => {
    const summary = selectionSummary(new Set([1, 2, 99]), [1, 2]);
    expect(summary.allSelected).toBe(true);
    expect(summary.selectedIds).toContain(99);
  });
});

describe("bulkActionDialogCopy", () => {
  it("singularizes the count for a single target", () => {
    const copy = bulkActionDialogCopy({ kind: "disable" }, 1);
    expect(copy.title).toContain("1 user");
    expect(copy.title).not.toContain("1 users");
  });

  it("pluralizes the count for multiple targets", () => {
    const copy = bulkActionDialogCopy({ kind: "disable" }, 4);
    expect(copy.title).toContain("4 users");
  });

  it("set_role is non-destructive and names the target role", () => {
    const action: PendingBulkAction = { kind: "set_role", role: "moderator" };
    const copy = bulkActionDialogCopy(action, 2);
    expect(copy.variant).toBe("default");
    expect(copy.description).toContain("Moderator");
  });

  it("falls back to the raw role string for an unrecognized role", () => {
    const action: PendingBulkAction = { kind: "set_role", role: "made-up" };
    const copy = bulkActionDialogCopy(action, 1);
    expect(copy.description).toContain("made-up");
  });

  it("disable and delete are both marked destructive", () => {
    expect(bulkActionDialogCopy({ kind: "disable" }, 1).variant).toBe(
      "destructive",
    );
    expect(bulkActionDialogCopy({ kind: "delete" }, 1).variant).toBe(
      "destructive",
    );
  });

  it("delete's copy warns it cannot be undone", () => {
    const copy = bulkActionDialogCopy({ kind: "delete" }, 3);
    expect(copy.description).toMatch(/cannot be undone/i);
  });
});

describe("summarizeBulkOutcome", () => {
  it("reads as success when every item succeeded", () => {
    const results: BulkItemResult[] = [
      { userId: 1, ok: true },
      { userId: 2, ok: true },
    ];
    const toast = summarizeBulkOutcome({
      succeeded: 2,
      failed: 0,
      results,
    });
    expect(toast.type).toBe("success");
    expect(toast.message).toContain("2 of 2");
  });

  it("still reads as success when only some items failed", () => {
    const results: BulkItemResult[] = [
      { userId: 1, ok: true },
      { userId: 2, ok: false, error: "User not found" },
    ];
    const toast = summarizeBulkOutcome({
      succeeded: 1,
      failed: 1,
      results,
    });
    expect(toast.type).toBe("success");
    expect(toast.message).toContain("1 succeeded, 1 failed");
    expect(toast.message).toContain("User not found");
  });

  it("reads as an error when every item failed", () => {
    const results: BulkItemResult[] = [
      { userId: 1, ok: false, error: "Password is incorrect." },
    ];
    const toast = summarizeBulkOutcome({
      succeeded: 0,
      failed: 1,
      results,
    });
    expect(toast.type).toBe("error");
  });

  it("handles a missing/empty results array without throwing", () => {
    const toast = summarizeBulkOutcome({
      succeeded: 0,
      failed: 0,
      results: [] as BulkItemResult[],
    });
    expect(toast.type).toBe("success");
    expect(toast.message).toContain("0 of 0");
  });
});
