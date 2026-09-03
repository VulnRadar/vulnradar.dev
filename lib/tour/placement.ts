import type { AnchorRect } from "./use-anchor-rect";

export type TourSide = "top" | "bottom" | "left" | "right";
export type TourPlacement = TourSide | "auto";

export interface Viewport {
  width: number;
  height: number;
}

export interface PlacementResult {
  side: TourSide;
  /** Viewport-relative position for the callout's top-left corner. */
  top: number;
  left: number;
  /**
   * Where the pointer should sit along the callout's anchored edge, measured
   * from the callout's own top-left. Already clamped so it never hangs off a
   * rounded corner when the callout has been pushed sideways to fit.
   */
  arrow: number;
}

/** Distance between the highlighted box and the callout. */
export const CALLOUT_GAP = 14;
/** Smallest allowed distance between the callout and the viewport edge. */
export const VIEWPORT_GUTTER = 12;
/** Half the pointer's width, plus the callout's corner radius. */
const ARROW_INSET = 22;

/**
 * How far the side already in use has to fall short before the callout leaves
 * it.
 *
 * This is the fix for the callout oscillating vertically, and the loop it
 * closes is worth spelling out. use-anchor-rect.ts re-measures the highlighted
 * element on every animation frame, and plenty of the elements this tour points
 * at legitimately change height while a step is on screen: the scan progress
 * panel's status line rewraps to a second line as each check family ticks over,
 * the results summary grows a row, a filter re-flows the list. When the room
 * under such an element sits near the callout's own height, a single-line
 * change is enough to cross the `room >= height` test, and with a fresh
 * decision every frame the callout answered a 20px content change with a
 * several-hundred-pixel jump to the other side of the anchor, then jumped back
 * on the next tick, at frame rate.
 *
 * Two thresholds instead of one break it. A side has to genuinely fit to be
 * ADOPTED, but only has to nearly fit to be KEPT. Between the two the callout
 * stays where it is and gets clamped into the viewport, which overlaps the
 * anchor's edge by a few pixels in the worst case: visibly better than a flip,
 * and the flip still happens the moment the side stops working for real.
 */
const SIDE_KEEP_MARGIN = 40;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** How much room a side has, once the gap and the gutter are paid for. */
function room(side: TourSide, anchor: AnchorRect, viewport: Viewport): number {
  switch (side) {
    case "top":
      return anchor.top - CALLOUT_GAP - VIEWPORT_GUTTER;
    case "bottom":
      return (
        viewport.height -
        (anchor.top + anchor.height) -
        CALLOUT_GAP -
        VIEWPORT_GUTTER
      );
    case "left":
      return anchor.left - CALLOUT_GAP - VIEWPORT_GUTTER;
    case "right":
      return (
        viewport.width -
        (anchor.left + anchor.width) -
        CALLOUT_GAP -
        VIEWPORT_GUTTER
      );
  }
}

function extent(side: TourSide, size: { width: number; height: number }) {
  return side === "top" || side === "bottom" ? size.height : size.width;
}

/**
 * Places the callout beside the highlighted box.
 *
 * Two rules, in order. Honour the step's preferred side if the callout fits
 * there; otherwise take the side with the most room. Falling back to "most
 * room" rather than a fixed flip order matters on a phone, where a wide
 * callout beside a full-width input never fits left or right and the only real
 * choice is above or below.
 *
 * The result is then clamped into the viewport on both axes, and the pointer
 * is moved along the anchored edge to compensate, so a callout shoved away
 * from the screen edge still points at the thing it describes. Without that
 * second half, every step anchored near a corner points at empty space.
 *
 * `current` is the side the callout is on right now, and passing it is what
 * makes the choice stable across frames rather than recomputed from nothing
 * sixty times a second. See SIDE_KEEP_MARGIN. It is deliberately weaker than
 * the preference: a side the step asked for and that now fits wins back the
 * callout immediately, which is what has to happen after a scroll-into-view
 * finally brings the anchor away from the edge it was pinned to on the first
 * frame.
 */
export function placeCallout(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: Viewport,
  preferred: TourPlacement = "auto",
  current?: TourSide,
): PlacementResult {
  const order: TourSide[] =
    preferred === "auto"
      ? ["bottom", "top", "right", "left"]
      : [
          preferred,
          ...(["bottom", "top", "right", "left"] as TourSide[]).filter(
            (s) => s !== preferred,
          ),
        ];

  const fits = (s: TourSide) => room(s, anchor, viewport) >= extent(s, size);
  const holds = (s: TourSide) =>
    room(s, anchor, viewport) >= extent(s, size) - SIDE_KEEP_MARGIN;

  let side: TourSide | undefined;
  if (preferred !== "auto" && fits(preferred)) side = preferred;
  else if (current && holds(current)) side = current;
  else side = order.find(fits);
  if (!side) {
    side = order.reduce((best, s) =>
      room(s, anchor, viewport) > room(best, anchor, viewport) ? s : best,
    );
  }

  const anchorCenterX = anchor.left + anchor.width / 2;
  const anchorCenterY = anchor.top + anchor.height / 2;

  let top: number;
  let left: number;
  if (side === "top") {
    top = anchor.top - CALLOUT_GAP - size.height;
    left = anchorCenterX - size.width / 2;
  } else if (side === "bottom") {
    top = anchor.top + anchor.height + CALLOUT_GAP;
    left = anchorCenterX - size.width / 2;
  } else if (side === "left") {
    top = anchorCenterY - size.height / 2;
    left = anchor.left - CALLOUT_GAP - size.width;
  } else {
    top = anchorCenterY - size.height / 2;
    left = anchor.left + anchor.width + CALLOUT_GAP;
  }

  left = clamp(
    left,
    VIEWPORT_GUTTER,
    viewport.width - size.width - VIEWPORT_GUTTER,
  );
  top = clamp(
    top,
    VIEWPORT_GUTTER,
    viewport.height - size.height - VIEWPORT_GUTTER,
  );

  const arrow =
    side === "top" || side === "bottom"
      ? clamp(
          anchorCenterX - left,
          ARROW_INSET,
          Math.max(ARROW_INSET, size.width - ARROW_INSET),
        )
      : clamp(
          anchorCenterY - top,
          ARROW_INSET,
          Math.max(ARROW_INSET, size.height - ARROW_INSET),
        );

  return { side, top, left, arrow };
}

/**
 * Grows the highlighted box by `padding` and clips it to the viewport.
 *
 * The clip is what stops the four scrim panels from misbehaving at a page
 * edge. A sticky header sits at a negative `top` once the page scrolls under
 * it; without this the top panel gets a negative height, which a browser
 * renders as zero, and the scrim quietly stops covering the strip above the
 * target. Clipping first means every panel is non-negative by construction.
 */
export function padRect(
  rect: AnchorRect,
  padding: number,
  viewport: Viewport,
): AnchorRect {
  const top = Math.max(0, rect.top - padding);
  const left = Math.max(0, rect.left - padding);
  const bottom = Math.min(viewport.height, rect.top + rect.height + padding);
  const right = Math.min(viewport.width, rect.left + rect.width + padding);
  return {
    top,
    left,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
