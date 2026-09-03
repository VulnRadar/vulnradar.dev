/**
 * Callout placement.
 *
 * Pure geometry, and the only part of the tour that can be wrong in a way a
 * reader sees immediately: a callout that covers the control it is describing,
 * or one that hangs off the edge of a phone screen. These are the cases that
 * actually came up while building it.
 */
import { describe, it, expect } from "vitest";
import {
  CALLOUT_GAP,
  padRect,
  placeCallout,
  VIEWPORT_GUTTER,
} from "@/lib/tour/placement";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SIZE = { width: 360, height: 220 };

describe("placeCallout", () => {
  it("honours the preferred side when it fits", () => {
    const anchor = { top: 400, left: 600, width: 200, height: 44 };
    const placed = placeCallout(anchor, SIZE, DESKTOP, "bottom");
    expect(placed.side).toBe("bottom");
    expect(placed.top).toBe(anchor.top + anchor.height + CALLOUT_GAP);
  });

  it("flips off a side with no room", () => {
    // A control 40px from the bottom of the window: "bottom" is the preference
    // and there is nowhere near 220px of room under it.
    const anchor = { top: 800, left: 600, width: 200, height: 44 };
    const placed = placeCallout(anchor, SIZE, DESKTOP, "bottom");
    expect(placed.side).toBe("top");
    expect(placed.top + SIZE.height).toBeLessThanOrEqual(anchor.top);
  });

  it("keeps the callout inside the viewport at a corner", () => {
    const anchor = { top: 8, left: 4, width: 32, height: 32 };
    const placed = placeCallout(anchor, SIZE, DESKTOP, "left");
    expect(placed.left).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(placed.top).toBeGreaterThanOrEqual(VIEWPORT_GUTTER);
    expect(placed.left + SIZE.width).toBeLessThanOrEqual(DESKTOP.width);
    expect(placed.top + SIZE.height).toBeLessThanOrEqual(DESKTOP.height);
  });

  it("moves the pointer to compensate when the callout is clamped", () => {
    // Anchor hard against the left edge, callout pushed right by the gutter.
    // Without the arrow compensation the pointer would sit under the middle of
    // the callout and point at nothing.
    const anchor = { top: 300, left: 0, width: 40, height: 40 };
    const placed = placeCallout(anchor, SIZE, DESKTOP, "bottom");
    const anchorCenter = anchor.left + anchor.width / 2;
    expect(placed.left + placed.arrow).toBeCloseTo(
      Math.max(anchorCenter, placed.left + 22),
      0,
    );
  });

  it("does not flip side when the anchor grows by a line of text", () => {
    // The jitter, reproduced. use-anchor-rect re-measures every animation
    // frame, and the scan progress panel this step points at grows and shrinks
    // by one wrapped line as each check family reports. Sized so the room below
    // it sits a few pixels either side of the callout's own height, which is
    // where a fresh fits/does-not-fit decision every frame threw the callout
    // from under the anchor to over it and back at frame rate.
    const room = (a: { top: number; height: number }) =>
      DESKTOP.height - (a.top + a.height) - CALLOUT_GAP - VIEWPORT_GUTTER;
    const roomy = { top: 400, left: 200, width: 700, height: 249 };
    const tight = { ...roomy, height: 269 };
    expect(room(roomy)).toBeGreaterThan(SIZE.height);
    expect(room(tight)).toBeLessThan(SIZE.height);

    const first = placeCallout(roomy, SIZE, DESKTOP, "bottom");
    expect(first.side).toBe("bottom");

    // Without the current-side argument this is the flip.
    expect(placeCallout(tight, SIZE, DESKTOP, "bottom").side).toBe("top");

    // With it, the callout stays put and is clamped instead, and it is still
    // there when the line unwraps again.
    const held = placeCallout(tight, SIZE, DESKTOP, "bottom", first.side);
    expect(held.side).toBe("bottom");
    expect(placeCallout(roomy, SIZE, DESKTOP, "bottom", held.side).side).toBe(
      "bottom",
    );
  });

  it("still flips when the side genuinely stops working", () => {
    // Stickiness is a tolerance, not a lock. A control 40px off the bottom of
    // the window has nowhere near enough room under it, and staying there
    // would put the callout over the thing it describes.
    const anchor = { top: 800, left: 600, width: 200, height: 44 };
    expect(placeCallout(anchor, SIZE, DESKTOP, "bottom", "bottom").side).toBe(
      "top",
    );
  });

  it("takes the preferred side back once it fits again", () => {
    // The first frame of a step is measured before scrollIntoView has finished
    // bringing the anchor to the middle of the screen, so the callout often
    // starts on a fallback side. When the scroll settles the step's own
    // preference has to win: stickiness must be weaker than the preference or
    // every step would keep whatever side its first frame happened to need.
    const centred = { top: 400, left: 600, width: 200, height: 44 };
    expect(placeCallout(centred, SIZE, DESKTOP, "bottom", "top").side).toBe(
      "bottom",
    );
  });

  it("never chooses a horizontal side on a phone-width viewport", () => {
    // A 360px callout cannot sit beside anything on a 390px screen, so the
    // "most room" fallback has to pick a vertical side rather than clamping a
    // left placement over the whole page.
    const anchor = { top: 300, left: 16, width: 358, height: 44 };
    const placed = placeCallout(anchor, SIZE, PHONE, "left");
    expect(["top", "bottom"]).toContain(placed.side);
  });
});

describe("padRect", () => {
  it("grows the box by the padding", () => {
    const padded = padRect(
      { top: 100, left: 100, width: 50, height: 20 },
      6,
      DESKTOP,
    );
    expect(padded).toEqual({ top: 94, left: 94, width: 62, height: 32 });
  });

  it("clips at the viewport edge rather than going negative", () => {
    // A sticky header scrolled under reports a negative top. Left unclipped,
    // the scrim's top panel gets a negative height, renders as zero, and stops
    // covering the strip above the target.
    const padded = padRect(
      { top: -20, left: -10, width: 200, height: 60 },
      8,
      DESKTOP,
    );
    expect(padded.top).toBe(0);
    expect(padded.left).toBe(0);
    expect(padded.height).toBe(48);
    expect(padded.width).toBe(198);
  });

  it("clips the far edges too", () => {
    const padded = padRect(
      { top: 880, left: 1400, width: 200, height: 60 },
      8,
      DESKTOP,
    );
    expect(padded.top + padded.height).toBeLessThanOrEqual(DESKTOP.height);
    expect(padded.left + padded.width).toBeLessThanOrEqual(DESKTOP.width);
  });
});
