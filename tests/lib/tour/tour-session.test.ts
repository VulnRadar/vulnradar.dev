/**
 * The tour's resume state.
 *
 * Small surface, but it is read straight into an array index
 * (`TOUR_STEPS[session.step]`), so a value that survives a release in which the
 * step list shrank is a crash on the next page load rather than a cosmetic
 * problem. These cover the clamp and the "storage is not available" path,
 * which is real: a private window, a locked-down webview, or a browser
 * configured to refuse site data all throw on the first read.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { tourSession } from "@/lib/tour/tour-session";
import { TOUR_STEPS } from "@/lib/tour/steps";

const KEY = "vr_tour";

function installStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  });
  return backing;
}

describe("tourSession", () => {
  let backing: Map<string, string>;

  beforeEach(() => {
    backing = installStorage();
  });

  it("round-trips a session", () => {
    tourSession.write({ step: 7, paused: true, replay: true });
    expect(tourSession.read()).toEqual({ step: 7, paused: true, replay: true });
  });

  it("returns null when nothing is stored", () => {
    expect(tourSession.read()).toBeNull();
  });

  it("clears on a null write", () => {
    tourSession.write({ step: 3, paused: false, replay: false });
    tourSession.write(null);
    expect(tourSession.read()).toBeNull();
    expect(backing.has(KEY)).toBe(false);
  });

  it("clamps a step index past the end of the current step list", () => {
    // The case this exists for: a reader is mid-tour when a release lands that
    // removed steps. Their stored index now points past the array, and the
    // orchestrator reads TOUR_STEPS[index].chapter on its very first render.
    backing.set(KEY, JSON.stringify({ step: 9999, paused: false }));
    expect(tourSession.read()?.step).toBe(TOUR_STEPS.length - 1);
  });

  it("clamps a negative or fractional step", () => {
    backing.set(KEY, JSON.stringify({ step: -4, paused: false }));
    expect(tourSession.read()?.step).toBe(0);
    backing.set(KEY, JSON.stringify({ step: 2.9, paused: false }));
    expect(tourSession.read()?.step).toBe(2);
  });

  it("ignores a stored value that is not a session", () => {
    backing.set(KEY, "not json");
    expect(tourSession.read()).toBeNull();
    backing.set(KEY, JSON.stringify({ paused: true }));
    expect(tourSession.read()).toBeNull();
  });

  it("survives storage that throws", () => {
    // Private mode and a few embedded webviews throw on access rather than
    // returning null. The tour still works for the length of one page, which
    // is why the index is held in React state as well.
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("access denied");
      },
    });
    expect(() =>
      tourSession.write({ step: 1, paused: false, replay: false }),
    ).not.toThrow();
    expect(tourSession.read()).toBeNull();
  });

  it("does not read a session left by a previous test file", () => {
    // Guard on the guard: installStorage must actually replace the global.
    vi.resetModules();
    expect(tourSession.read()).toBeNull();
  });
});
