/**
 * Putting focus back on the finding that was opened
 * (components/scanner/finding-focus.ts).
 *
 * Opening a finding unmounts the row that was activated and Back mounts a new
 * list, so focus is dropped on <body> twice. The list restored scroll but not
 * focus, which left a keyboard user at the top of the filter bar after every
 * finding. The DOM lookup is exercised against a stand-in for the list, and the
 * hand-off between the closing view and the mounting list is exercised with
 * the same ordering React gives it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  focusFindingRow,
  noteFindingClosed,
  rememberOpenedFinding,
  takeFindingToRefocus,
} from "@/components/scanner/finding-focus";

function row(id: string) {
  return { dataset: { findingId: id }, focus: vi.fn() };
}

function listOf(...ids: string[]) {
  const rows = ids.map(row);
  return {
    rows,
    root: {
      querySelectorAll: () => rows,
    } as unknown as ParentNode,
  };
}

describe("focusFindingRow", () => {
  it("focuses the row whose finding id matches, and only that one", () => {
    const { rows, root } = listOf("a", "b", "c");

    expect(focusFindingRow(root, "b")).toBe(true);

    expect(rows[1].focus).toHaveBeenCalledTimes(1);
    expect(rows[0].focus).not.toHaveBeenCalled();
    expect(rows[2].focus).not.toHaveBeenCalled();
  });

  it("reports false when a filter has hidden the row, and focuses nothing", () => {
    const { rows, root } = listOf("a", "c");

    expect(focusFindingRow(root, "b")).toBe(false);
    for (const r of rows) expect(r.focus).not.toHaveBeenCalled();
  });

  it("matches an id that would break a selector", () => {
    // A finding id is whatever the check author wrote: quotes, brackets and
    // colons included. Comparing the attribute means none of that is parsed.
    const odd = `weird"]:id[x`;
    const { rows, root } = listOf("plain", odd);

    expect(focusFindingRow(root, odd)).toBe(true);
    expect(rows[1].focus).toHaveBeenCalled();
  });
});

describe("handing focus back to the list", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Start every case from nothing remembered.
    takeFindingToRefocus();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("returns the opened finding to the list that mounts as the view closes", () => {
    rememberOpenedFinding("missing-csp-header");
    // IssueDetail's cleanup runs, then the list's mount effect, in one commit.
    noteFindingClosed();
    expect(takeFindingToRefocus()).toBe("missing-csp-header");
  });

  it("hands it over once", () => {
    rememberOpenedFinding("x");
    noteFindingClosed();
    expect(takeFindingToRefocus()).toBe("x");
    expect(takeFindingToRefocus()).toBeNull();
  });

  it("gives a list nothing when no finding just closed", () => {
    // A list that mounts on a fresh page load keeps the focus it was given,
    // even if a finding was opened earlier in this tab.
    rememberOpenedFinding("x");
    expect(takeFindingToRefocus()).toBeNull();
  });

  it("lets a closed finding's claim lapse if no list mounts in that commit", () => {
    // The person left the page from inside a finding. IssueDetail unmounted,
    // no list came with it, and a list that mounts later is not a Back.
    rememberOpenedFinding("x");
    noteFindingClosed();
    vi.runAllTimers();
    expect(takeFindingToRefocus()).toBeNull();
  });

  it("follows the finding that was opened last", () => {
    rememberOpenedFinding("first");
    rememberOpenedFinding("second");
    noteFindingClosed();
    expect(takeFindingToRefocus()).toBe("second");
  });
});
