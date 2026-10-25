import { describe, it, expect, vi, type Mock } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DISMISS_SELECTOR,
  focusAfterRemoval,
  focusIndexAfterRemoval,
  type FocusRow,
  type FocusTarget,
} from "@/components/shared/notification-focus";

/**
 * Where focus goes when a row leaves the notification panel. The helper takes
 * rows and a heading as plain objects, so these run without a DOM; the wiring
 * from the panel to the helper is pinned in the last block from the source.
 */

function target(): FocusTarget & { focus: Mock<() => void> } {
  return { focus: vi.fn<() => void>() };
}

/**
 * A row holding some of the things the helper looks for. `dismiss` and
 * `action` are what querySelector answers for the dismiss and first-action
 * selectors respectively.
 */
function row(parts: { dismiss?: FocusTarget; action?: FocusTarget }): FocusRow {
  return {
    querySelector(selector: string) {
      if (selector === DISMISS_SELECTOR) return parts.dismiss ?? null;
      return parts.action ?? null;
    },
  };
}

describe("focusIndexAfterRemoval", () => {
  it("takes the row that moved up into the removed one's place", () => {
    expect(focusIndexAfterRemoval(0, 3)).toBe(0);
    expect(focusIndexAfterRemoval(1, 3)).toBe(1);
  });

  it("falls back to the new last row when the last one was removed", () => {
    expect(focusIndexAfterRemoval(3, 3)).toBe(2);
    expect(focusIndexAfterRemoval(9, 3)).toBe(2);
  });

  it("has no row to offer when none are left", () => {
    expect(focusIndexAfterRemoval(0, 0)).toBeNull();
    expect(focusIndexAfterRemoval(4, 0)).toBeNull();
  });

  it("treats an unknown position as the first row", () => {
    // indexOf() answers -1 for a row the panel could not find.
    expect(focusIndexAfterRemoval(-1, 2)).toBe(0);
  });
});

describe("focusAfterRemoval", () => {
  it("focuses the next row's dismiss control, not its first action", () => {
    const dismissA = target();
    const actionA = target();
    const dismissB = target();
    const heading = target();
    const result = focusAfterRemoval(
      [row({ dismiss: dismissA, action: actionA }), row({ dismiss: dismissB })],
      0,
      heading,
    );
    expect(result).toBe("row");
    expect(dismissA.focus).toHaveBeenCalledTimes(1);
    // "Accept invite" is the first action of an invite row. Landing a reader
    // who has just dismissed something on a control that joins a team is the
    // wrong failure.
    expect(actionA.focus).not.toHaveBeenCalled();
    expect(dismissB.focus).not.toHaveBeenCalled();
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it("lands on the previous row when the last one was dismissed", () => {
    const first = target();
    const second = target();
    const result = focusAfterRemoval(
      [row({ dismiss: first }), row({ dismiss: second })],
      2,
      target(),
    );
    expect(result).toBe("row");
    expect(second.focus).toHaveBeenCalledTimes(1);
    expect(first.focus).not.toHaveBeenCalled();
  });

  it("uses a row's first action when that row has nothing to dismiss", () => {
    // A staff notice that is not dismissible still has its link.
    const action = target();
    const heading = target();
    expect(focusAfterRemoval([row({ action })], 0, heading)).toBe("row");
    expect(action.focus).toHaveBeenCalledTimes(1);
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it("goes to the panel heading when the list is empty", () => {
    const heading = target();
    expect(focusAfterRemoval([], 0, heading)).toBe("heading");
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });

  it("goes to the panel heading when the row has nothing focusable", () => {
    const heading = target();
    expect(focusAfterRemoval([row({})], 0, heading)).toBe("heading");
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });

  it("reports that nothing took focus when there is no heading either", () => {
    expect(focusAfterRemoval([], 0, null)).toBe("none");
    expect(focusAfterRemoval([row({})], 0, null)).toBe("none");
  });

  it("walks a whole list down one dismissal at a time", () => {
    // Three rows, always dismissing whichever has focus: each press hands
    // focus to the row now in the same spot, then the heading at the end.
    const dismiss = [target(), target(), target()];
    const heading = target();
    const rows = dismiss.map((d) => row({ dismiss: d }));

    focusAfterRemoval(rows.slice(1), 0, heading); // row 0 removed
    expect(dismiss[1].focus).toHaveBeenCalledTimes(1);

    focusAfterRemoval(rows.slice(2), 0, heading); // row 1 removed
    expect(dismiss[2].focus).toHaveBeenCalledTimes(1);

    focusAfterRemoval([], 0, heading); // row 2 removed
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });
});

describe("the notification panel is wired to it", () => {
  const ROOT = path.resolve(__dirname, "../../..");
  const src = fs
    .readFileSync(
      path.join(ROOT, "components/shared/notification-center.tsx"),
      "utf8",
    )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("marks every kind of row and its dismiss control", () => {
    expect(src).toContain("data-notif-row={`user-${n.id}`}");
    expect(src).toContain('data-notif-row="version"');
    expect(src).toContain("data-notif-row={`api-${n.id}`}");
    expect(src.match(/data-notif-dismiss=""/g)).toHaveLength(3);
    // The selector the helper uses is the attribute the panel renders.
    expect(DISMISS_SELECTOR).toBe("[data-notif-dismiss]");
  });

  it("remembers the row before it goes, from each dismiss click", () => {
    expect(src.match(/rememberRow\(e\.currentTarget\)/g)).toHaveLength(3);
  });

  it("gives the panel heading a focus target for an emptied list", () => {
    expect(src).toMatch(/<h2\s+ref=\{headingRef\}\s+tabIndex=\{-1\}/);
    expect(src).toContain(
      "focusAfterRemoval(rows, pending.index, headingRef.current)",
    );
  });

  it("drops the pending focus when the dismissal fails", () => {
    const failure = src.slice(
      src.indexOf("Could not dismiss the notification") - 200,
      src.indexOf("Could not dismiss the notification"),
    );
    expect(failure).toContain("pendingFocusRef.current = null");
  });
});
