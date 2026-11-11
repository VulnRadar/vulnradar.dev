import { describe, it, expect } from "vitest";
import {
  HINT_CLOSED,
  HINT_CLOSE_DELAY_MS,
  closesOnPageScroll,
  HINT_OPEN_DELAY_MS,
  stepHint,
  type HintEvent,
  type HintState,
} from "@/components/shared/info-hint-state";

const OPEN_BY_HOVER: HintState = { open: true, source: "hover" };
const OPEN_BY_FOCUS: HintState = { open: true, source: "focus" };
const OPEN_BY_CLICK: HintState = { open: true, source: "click" };

/** Run a sequence of events from a starting state, ignoring timers. */
function run(start: HintState, events: HintEvent[]): HintState {
  return events.reduce((s, e) => stepHint(s, e).state, start);
}

describe("stepHint: mouse", () => {
  it("schedules an open after a short delay, and does not open at once", () => {
    const step = stepHint(HINT_CLOSED, {
      type: "pointer-enter",
      pointerType: "mouse",
    });
    expect(step.state).toEqual(HINT_CLOSED);
    expect(step.timer).toEqual({ kind: "open", ms: HINT_OPEN_DELAY_MS });
  });

  it("opens when the open timer fires, as a hover", () => {
    expect(
      stepHint(HINT_CLOSED, { type: "timer", kind: "open" }).state,
    ).toEqual(OPEN_BY_HOVER);
  });

  it("leaving before the delay ends cancels the pending open", () => {
    const step = stepHint(HINT_CLOSED, {
      type: "pointer-leave",
      pointerType: "mouse",
    });
    expect(step.state).toEqual(HINT_CLOSED);
    expect(step.timer).toEqual({ kind: "cancel" });
  });

  it("a hover-opened hint closes after a grace period, not at once", () => {
    const step = stepHint(OPEN_BY_HOVER, {
      type: "pointer-leave",
      pointerType: "mouse",
    });
    expect(step.state).toEqual(OPEN_BY_HOVER);
    expect(step.timer).toEqual({ kind: "close", ms: HINT_CLOSE_DELAY_MS });
  });

  it("moving onto the panel inside the grace period keeps it open", () => {
    const left = stepHint(OPEN_BY_HOVER, {
      type: "pointer-leave",
      pointerType: "mouse",
    });
    const entered = stepHint(left.state, { type: "content-enter" });
    expect(entered.state).toEqual(OPEN_BY_HOVER);
    expect(entered.timer).toEqual({ kind: "cancel" });
  });

  it("leaving the panel closes a hover-opened hint after the grace period", () => {
    const step = stepHint(OPEN_BY_HOVER, { type: "content-leave" });
    expect(step.timer).toEqual({ kind: "close", ms: HINT_CLOSE_DELAY_MS });
    expect(
      stepHint(step.state, { type: "timer", kind: "close" }).state,
    ).toEqual(HINT_CLOSED);
  });

  it("a pen hovers like a mouse", () => {
    const step = stepHint(HINT_CLOSED, {
      type: "pointer-enter",
      pointerType: "pen",
    });
    expect(step.timer).toEqual({ kind: "open", ms: HINT_OPEN_DELAY_MS });
  });

  it("clicking a hover-opened hint pins it instead of closing it", () => {
    const step = stepHint(OPEN_BY_HOVER, { type: "click", keyboard: false });
    expect(step.state).toEqual(OPEN_BY_CLICK);
  });

  it("a pinned hint survives the pointer leaving", () => {
    const state = run(OPEN_BY_HOVER, [
      { type: "click", keyboard: false },
      { type: "pointer-leave", pointerType: "mouse" },
      { type: "timer", kind: "close" },
    ]);
    expect(state).toEqual(OPEN_BY_CLICK);
  });

  it("clicking a pinned hint closes it", () => {
    expect(
      stepHint(OPEN_BY_CLICK, { type: "click", keyboard: false }).state,
    ).toEqual(HINT_CLOSED);
  });

  it("a click before the open delay ends opens it and cancels the timer", () => {
    const step = stepHint(HINT_CLOSED, { type: "click", keyboard: false });
    expect(step.state).toEqual(OPEN_BY_CLICK);
    expect(step.timer).toEqual({ kind: "cancel" });
    expect(stepHint(step.state, { type: "timer", kind: "open" }).state).toEqual(
      OPEN_BY_CLICK,
    );
  });

  it("a stale close timer cannot close a pinned hint", () => {
    expect(
      stepHint(OPEN_BY_CLICK, { type: "timer", kind: "close" }).state,
    ).toEqual(OPEN_BY_CLICK);
  });
});

describe("stepHint: touch", () => {
  it("ignores the synthetic hover that comes with a tap", () => {
    const enter = stepHint(HINT_CLOSED, {
      type: "pointer-enter",
      pointerType: "touch",
    });
    expect(enter.state).toEqual(HINT_CLOSED);
    expect(enter.timer).toBeNull();
  });

  it("a tap opens it and the finger lifting does not close it", () => {
    const state = run(HINT_CLOSED, [
      { type: "pointer-enter", pointerType: "touch" },
      { type: "click", keyboard: false },
      { type: "pointer-leave", pointerType: "touch" },
    ]);
    expect(state).toEqual(OPEN_BY_CLICK);
  });

  it("a second tap closes it", () => {
    const state = run(HINT_CLOSED, [
      { type: "click", keyboard: false },
      { type: "click", keyboard: false },
    ]);
    expect(state).toEqual(HINT_CLOSED);
  });

  it("an outside press, Escape or a page scroll all arrive as dismiss", () => {
    expect(stepHint(OPEN_BY_CLICK, { type: "dismiss" }).state).toEqual(
      HINT_CLOSED,
    );
  });
});

describe("stepHint: keyboard", () => {
  it("opens on focus-visible, as a focus hint", () => {
    expect(
      stepHint(HINT_CLOSED, { type: "focus", focusVisible: true }).state,
    ).toEqual(OPEN_BY_FOCUS);
  });

  it("does not open on a focus that came from a pointer", () => {
    expect(
      stepHint(HINT_CLOSED, { type: "focus", focusVisible: false }).state,
    ).toEqual(HINT_CLOSED);
  });

  it("closes on blur when focus opened it", () => {
    expect(stepHint(OPEN_BY_FOCUS, { type: "blur" }).state).toEqual(
      HINT_CLOSED,
    );
  });

  it("does not close on blur when it was pinned", () => {
    expect(stepHint(OPEN_BY_CLICK, { type: "blur" }).state).toEqual(
      OPEN_BY_CLICK,
    );
  });

  it("Enter on a focus-opened hint closes it", () => {
    expect(
      stepHint(OPEN_BY_FOCUS, { type: "click", keyboard: true }).state,
    ).toEqual(HINT_CLOSED);
  });

  it("Enter on a closed hint opens and pins it", () => {
    expect(
      stepHint(HINT_CLOSED, { type: "click", keyboard: true }).state,
    ).toEqual(OPEN_BY_CLICK);
  });

  it("Escape (dismiss) closes whichever way it was opened", () => {
    for (const s of [OPEN_BY_HOVER, OPEN_BY_FOCUS, OPEN_BY_CLICK]) {
      expect(stepHint(s, { type: "dismiss" }).state).toEqual(HINT_CLOSED);
    }
  });

  it("keyboard focus upgrades a hover-opened hint so leaving the pointer does not close it", () => {
    const state = run(OPEN_BY_HOVER, [
      { type: "focus", focusVisible: true },
      { type: "pointer-leave", pointerType: "mouse" },
      { type: "timer", kind: "close" },
    ]);
    expect(state).toEqual(OPEN_BY_FOCUS);
  });
});

describe("closesOnPageScroll", () => {
  it("does not close a hint that keyboard focus is holding", () => {
    // Tab scrolls the focused control into view, which is a page scroll.
    expect(closesOnPageScroll(OPEN_BY_FOCUS)).toBe(false);
  });

  it("closes hover and click hints, like every other popover", () => {
    expect(closesOnPageScroll(OPEN_BY_HOVER)).toBe(true);
    expect(closesOnPageScroll(OPEN_BY_CLICK)).toBe(true);
    expect(closesOnPageScroll(HINT_CLOSED)).toBe(true);
  });
});

describe("stepHint: edges that must stay inert", () => {
  it("re-entering a hover-opened hint cancels the pending close", () => {
    expect(
      stepHint(OPEN_BY_HOVER, { type: "pointer-enter", pointerType: "mouse" })
        .timer,
    ).toEqual({ kind: "cancel" });
  });

  it("re-entering a pinned or focus-held hint changes nothing", () => {
    for (const s of [OPEN_BY_CLICK, OPEN_BY_FOCUS]) {
      const step = stepHint(s, { type: "pointer-enter", pointerType: "mouse" });
      expect(step.state).toEqual(s);
      expect(step.timer).toBeNull();
    }
  });

  it("leaving the panel does not close a pinned or focus-held hint", () => {
    for (const s of [OPEN_BY_CLICK, OPEN_BY_FOCUS]) {
      const step = stepHint(s, { type: "content-leave" });
      expect(step.state).toEqual(s);
      expect(step.timer).toBeNull();
    }
  });

  it("a touch pointer leaving does nothing, open or closed", () => {
    for (const s of [HINT_CLOSED, OPEN_BY_CLICK]) {
      const step = stepHint(s, { type: "pointer-leave", pointerType: "touch" });
      expect(step.state).toEqual(s);
      expect(step.timer).toBeNull();
    }
  });
});
