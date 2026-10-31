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
import fs from "node:fs";
import path from "node:path";
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
    expect(tourSession.read(TOUR_STEPS.length)?.step).toBe(
      TOUR_STEPS.length - 1,
    );
  });

  it("does not import the step list, so the layout gate stays light", () => {
    // tour-mount.tsx is in the root layout and calls read() only to learn
    // whether a session exists. A static import of ./steps here dragged all
    // of the tour's copy into every route's entry chunk.
    const src = fs.readFileSync(
      path.join(__dirname, "../../../lib/tour/tour-session.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["']\.\/steps["']/);
    expect(src).not.toMatch(/from\s+["']@\/lib\/tour\/steps["']/);
  });

  it("floors a negative index but caps nothing when the caller passes no step count", () => {
    backing.set(KEY, JSON.stringify({ step: 9999, paused: false }));
    expect(tourSession.read()?.step).toBe(9999);
    backing.set(KEY, JSON.stringify({ step: -4, paused: false }));
    expect(tourSession.read()?.step).toBe(0);
  });

  it("clamps to zero for an empty step list", () => {
    backing.set(KEY, JSON.stringify({ step: 5, paused: false }));
    expect(tourSession.read(0)?.step).toBe(0);
  });

  it("clamps a negative or fractional step", () => {
    backing.set(KEY, JSON.stringify({ step: -4, paused: false }));
    expect(tourSession.read(TOUR_STEPS.length)?.step).toBe(0);
    backing.set(KEY, JSON.stringify({ step: 2.9, paused: false }));
    expect(tourSession.read(TOUR_STEPS.length)?.step).toBe(2);
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
