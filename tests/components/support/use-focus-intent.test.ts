/**
 * Moving focus after an in-place view swap (components/support/use-focus-intent).
 *
 * The ticket screens replace a list with a thread and a button with a form
 * without navigating, so whatever had focus is removed and focus falls to
 * <body>. These pin the part that decides where it goes instead: which target
 * wins, when an intent is used up, and when it gives up. The effect that calls
 * them on each render is covered by the source checks in
 * tests/components/support/focus-wiring.test.ts, because this config has no DOM.
 */
import { describe, it, expect, vi } from "vitest";
import {
  FOCUS_INTENT_TTL_MS,
  applyFocusIntent,
  focusSelector,
  stepFocusIntent,
  type FocusRoot,
} from "@/components/support/use-focus-intent";

interface FakeElement {
  focus: ReturnType<typeof vi.fn>;
  ownerDocument?: { activeElement: unknown };
}

/** A root holding some elements by data-focus-id. */
function fakeRoot(ids: Record<string, FakeElement>): FocusRoot {
  return {
    querySelector(selector: string) {
      const match = /^\[data-focus-id="(.*)"\]$/.exec(selector);
      return match ? (ids[match[1].replace(/\\(["\\])/g, "$1")] ?? null) : null;
    },
  };
}

function element(): FakeElement {
  return { focus: vi.fn() };
}

describe("focusSelector", () => {
  it("selects by the data attribute the components write", () => {
    expect(focusSelector("thread-heading")).toBe(
      '[data-focus-id="thread-heading"]',
    );
  });

  it("escapes a quote or backslash rather than breaking out of the selector", () => {
    expect(focusSelector('a"]x')).toBe('[data-focus-id="a\\"]x"]');
    expect(focusSelector("a\\b")).toBe('[data-focus-id="a\\\\b"]');
  });
});

describe("applyFocusIntent", () => {
  it("focuses the target and reports it", () => {
    const heading = element();
    expect(
      applyFocusIntent(
        fakeRoot({ "thread-heading": heading }),
        "thread-heading",
      ),
    ).toBe(true);
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });

  it("reports false, and touches nothing, while the target is not on screen yet", () => {
    // The thread heading is rendered only after the fetch resolves, so the
    // first renders after the click do not have it.
    const other = element();
    expect(applyFocusIntent(fakeRoot({ reply: other }), "thread-heading")).toBe(
      false,
    );
    expect(other.focus).not.toHaveBeenCalled();
  });

  it("is false with no root at all", () => {
    expect(applyFocusIntent(null, "reply")).toBe(false);
  });

  it("tries a list of targets in order and uses the first that exists", () => {
    // Back from a thread: the row you came from, else the New ticket button.
    const button = element();
    const row = element();
    const root = fakeRoot({ "new-ticket": button });
    expect(applyFocusIntent(root, ["ticket-row-7", "new-ticket"])).toBe(true);
    expect(button.focus).toHaveBeenCalledTimes(1);

    const both = fakeRoot({ "ticket-row-7": row, "new-ticket": button });
    button.focus.mockClear();
    expect(applyFocusIntent(both, ["ticket-row-7", "new-ticket"])).toBe(true);
    expect(row.focus).toHaveBeenCalledTimes(1);
    expect(button.focus).not.toHaveBeenCalled();
  });

  it("does not count a refusal as done, so a closing dialog's trap cannot use the intent up", () => {
    // A modal's focus trap hands focus straight back, so focus() on a control
    // behind it leaves activeElement somewhere else. That must stay pending.
    const heading = element();
    const dialogButton = {};
    heading.ownerDocument = { activeElement: dialogButton };
    expect(
      applyFocusIntent(
        fakeRoot({ "thread-heading": heading }),
        "thread-heading",
      ),
    ).toBe(false);
    expect(heading.focus).toHaveBeenCalledTimes(1);

    heading.ownerDocument = { activeElement: heading };
    expect(
      applyFocusIntent(
        fakeRoot({ "thread-heading": heading }),
        "thread-heading",
      ),
    ).toBe(true);
  });

  it("falls through to the next target when the first will not take focus", () => {
    const stuck = element();
    stuck.ownerDocument = { activeElement: {} };
    const next = element();
    expect(applyFocusIntent(fakeRoot({ a: stuck, b: next }), ["a", "b"])).toBe(
      true,
    );
    expect(next.focus).toHaveBeenCalled();
  });
});

describe("stepFocusIntent", () => {
  const since = 1_000_000;

  it("does nothing without an intent", () => {
    expect(stepFocusIntent(null, fakeRoot({}), since)).toBeNull();
  });

  it("is used up once its target takes focus", () => {
    const reply = element();
    expect(
      stepFocusIntent(
        { target: "reply", since },
        fakeRoot({ reply }),
        since + 10,
      ),
    ).toBeNull();
    expect(reply.focus).toHaveBeenCalledTimes(1);
  });

  it("waits, unchanged, until its target appears", () => {
    const pending = { target: "thread-heading", since };
    expect(stepFocusIntent(pending, fakeRoot({}), since + 100)).toBe(pending);
    const heading = element();
    expect(
      stepFocusIntent(
        pending,
        fakeRoot({ "thread-heading": heading }),
        since + 200,
      ),
    ).toBeNull();
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });

  it("gives up after the TTL, so a failed load cannot take focus minutes later", () => {
    const heading = element();
    const pending = { target: "thread-heading", since };
    const root = fakeRoot({ "thread-heading": heading });
    expect(
      stepFocusIntent(pending, root, since + FOCUS_INTENT_TTL_MS + 1),
    ).toBeNull();
    // And it did not focus on its way out.
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it("still acts at exactly the TTL", () => {
    const heading = element();
    expect(
      stepFocusIntent(
        { target: "thread-heading", since },
        fakeRoot({ "thread-heading": heading }),
        since + FOCUS_INTENT_TTL_MS,
      ),
    ).toBeNull();
    expect(heading.focus).toHaveBeenCalledTimes(1);
  });
});
