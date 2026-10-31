"use client";

/**
 * Where a half-finished tour lives between page loads.
 *
 * The tour spans six routes. Most of the time it never unmounts while crossing
 * them, because it is mounted in the root layout and Next's App Router does
 * those transitions client-side, so React state alone carries the step index.
 * That covers the common path and none of the interesting ones: a hard reload,
 * a middleware redirect, a link opened from the command palette, a browser
 * back that lands on a server-rendered page. In all of those the component
 * remounts at step zero and the reader is sent back to "type a URL" from step
 * twenty-nine.
 *
 * So the index is mirrored here on every change. sessionStorage rather than
 * localStorage on purpose: a tour is a thing you are doing in this tab right
 * now. localStorage would resume it in a second tab that never started one, and
 * would still be sitting there a week later.
 */
const STORAGE_KEY = "vr_tour";

export interface TourSession {
  /** Index into TOUR_STEPS. */
  step: number;
  /** Paused means the overlay is down but the tour is not finished. */
  paused: boolean;
  /**
   * True when the reader asked for this tour rather than being given it on
   * first login. A replay must not mark onboarding complete a second time, and
   * more importantly must not be suppressed by the completed flag.
   */
  replay: boolean;
}

/**
 * @param stepCount TOUR_STEPS.length, from a caller that is about to index the
 *   step list. This module does not import the list itself: components/shared/
 *   tour/tour-mount.tsx sits in the root layout and only asks whether a session
 *   exists, and importing the step copy here put every line of it in the entry
 *   chunk of every route. A caller that omits it gets the index floored at zero
 *   and not capped, which is only safe for a caller that never indexes with it.
 */
function read(stepCount?: number): TourSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourSession>;
    if (typeof parsed.step !== "number") return null;
    // A persisted index outside the current step list means the tour changed
    // under a session that was mid-flight. Resuming at a step that no longer
    // exists would either crash or silently land somewhere unrelated, so clamp.
    const floored = Math.max(0, Math.floor(parsed.step));
    const step =
      stepCount === undefined
        ? floored
        : Math.min(floored, Math.max(0, stepCount - 1));
    return {
      step,
      paused: parsed.paused === true,
      replay: parsed.replay === true,
    };
  } catch {
    return null;
  }
}

function write(session: TourSession | null): void {
  try {
    if (session === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private mode, a storage quota, an embedded webview with storage off.
    // The tour still works for the length of this page, which is the whole
    // point of keeping the index in React state as well.
  }
}

export const tourSession = { read, write };
