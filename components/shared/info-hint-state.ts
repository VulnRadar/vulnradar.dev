/**
 * The open/close rules of an InfoHint, as a pure function.
 *
 * Why it is separate from the component: the rules are the part that goes
 * wrong (a hint that opens under a finger and shuts on the lift, a hint that
 * closes while the pointer crosses the gap to it, a click that closes what a
 * hover just opened), and the component test environment here is plain node
 * with no DOM. A reducer can be tested without one.
 *
 * `source` records why the hint is open, because that decides what closes it:
 *   hover  the pointer opened it, so the pointer leaving closes it
 *   focus  keyboard focus opened it, so focus leaving closes it
 *   click  a click, tap or Enter pinned it, so only another click, Escape,
 *          an outside press or a page scroll closes it
 */
export type HintSource = "hover" | "focus" | "click";

export interface HintState {
  open: boolean;
  source: HintSource | null;
}

export type HintTimer =
  { kind: "open" | "close"; ms: number } | { kind: "cancel" } | null;

export interface HintStep {
  state: HintState;
  timer: HintTimer;
}

export type HintEvent =
  | { type: "pointer-enter"; pointerType: string }
  | { type: "pointer-leave"; pointerType: string }
  | { type: "content-enter" }
  | { type: "content-leave" }
  | { type: "focus"; focusVisible: boolean }
  | { type: "blur" }
  | { type: "click"; keyboard: boolean }
  | { type: "dismiss" }
  | { type: "timer"; kind: "open" | "close" };

export const HINT_OPEN_DELAY_MS = 120;
export const HINT_CLOSE_DELAY_MS = 160;

export const HINT_CLOSED: HintState = { open: false, source: null };

const CANCEL: HintTimer = { kind: "cancel" };

/**
 * Whether a page scroll should close the hint. Not when keyboard focus is
 * holding it: tabbing to a control scrolls it into view, so the scroll that
 * Tab causes would otherwise close the hint it had just opened, and only for
 * controls that start off screen. Hover and click hints close on scroll like
 * every other popover (components/ui/popover.tsx).
 */
export function closesOnPageScroll(state: HintState): boolean {
  return state.source !== "focus";
}

function isHoverPointer(pointerType: string): boolean {
  return pointerType !== "touch";
}

export function stepHint(state: HintState, event: HintEvent): HintStep {
  switch (event.type) {
    case "pointer-enter": {
      if (!isHoverPointer(event.pointerType)) return { state, timer: null };
      if (state.open) {
        return {
          state,
          timer: state.source === "hover" ? CANCEL : null,
        };
      }
      return { state, timer: { kind: "open", ms: HINT_OPEN_DELAY_MS } };
    }

    case "pointer-leave": {
      if (!isHoverPointer(event.pointerType)) return { state, timer: null };
      if (!state.open) return { state, timer: CANCEL };
      if (state.source === "hover") {
        return { state, timer: { kind: "close", ms: HINT_CLOSE_DELAY_MS } };
      }
      return { state, timer: null };
    }

    case "content-enter":
      return { state, timer: state.open ? CANCEL : null };

    case "content-leave": {
      if (state.open && state.source === "hover") {
        return { state, timer: { kind: "close", ms: HINT_CLOSE_DELAY_MS } };
      }
      return { state, timer: null };
    }

    case "focus": {
      if (!event.focusVisible) return { state, timer: null };
      if (state.open && state.source !== "hover") return { state, timer: null };
      return { state: { open: true, source: "focus" }, timer: CANCEL };
    }

    case "blur": {
      if (state.open && state.source === "focus") {
        return { state: HINT_CLOSED, timer: CANCEL };
      }
      return { state, timer: null };
    }

    case "click": {
      if (!state.open) {
        return { state: { open: true, source: "click" }, timer: CANCEL };
      }
      if (event.keyboard || state.source === "click") {
        return { state: HINT_CLOSED, timer: CANCEL };
      }
      return { state: { open: true, source: "click" }, timer: CANCEL };
    }

    case "dismiss":
      return { state: HINT_CLOSED, timer: CANCEL };

    case "timer": {
      if (event.kind === "open") {
        if (state.open) return { state, timer: null };
        return { state: { open: true, source: "hover" }, timer: null };
      }
      if (state.open && state.source === "hover") {
        return { state: HINT_CLOSED, timer: null };
      }
      return { state, timer: null };
    }
  }
}
