"use client";

import { useEffect, useState } from "react";
import { resolveAnchor, type TourAnchor } from "./anchors";

/** Viewport-relative box, in CSS pixels. Same axes as getBoundingClientRect. */
export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type AnchorState =
  /** No anchor asked for. A chapter card, not a coach mark. */
  | "none"
  /** Asked for, not on the page yet, still inside the grace window. */
  | "resolving"
  /** On the page and measured. */
  | "found"
  /** Grace window elapsed and it never appeared. */
  | "missing";

export interface AnchorTracking {
  rect: AnchorRect | null;
  state: AnchorState;
  element: HTMLElement | null;
}

/**
 * How long an anchor is allowed to be absent before the step gives up on
 * pointing at it. Generous on purpose: the elements this tour points at include
 * a lazily-imported kebab menu, a feedback control that renders null until its
 * own GET resolves, and anything on the far side of a route transition. A
 * 200ms timeout would call all three of those missing and degrade a step that
 * was about to work.
 */
const RESOLVE_GRACE_MS = 2500;

function idle(anchor: TourAnchor | undefined): AnchorTracking {
  return { rect: null, state: anchor ? "resolving" : "none", element: null };
}

/**
 * Two rects are the same if they round to the same whole pixel.
 *
 * This was a half-pixel comparison, which let sub-pixel noise through: a
 * getBoundingClientRect() on a page mid-smooth-scroll, or on an element inside
 * a flex row whose siblings are animating, returns fractional values that
 * wobble by a few hundredths between frames. Every one of those wobbles was a
 * state update, a re-render of the whole overlay and a fresh placement
 * decision. Nothing moved by an amount anyone could see, and the callout was
 * re-deciding which side of the anchor to sit on sixty times a second on a
 * page that was standing still. A whole pixel is the smallest difference the
 * spotlight can actually draw, so anything under it is not information.
 */
function same(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height)
  );
}

/**
 * Tracks the live position of a tour anchor.
 *
 * A one-time `getBoundingClientRect()` on step entry is the obvious
 * implementation and it is wrong for every element on this tour's list. The
 * scan form grows a warning row under the input while you type in it; the
 * results list re-flows when a severity filter is toggled; the header is
 * `position: fixed` under a banner whose height is a CSS variable that changes;
 * and the reader is free to scroll at any point because the whole premise is
 * that they are driving. A callout pinned to a stale rect drifts away from the
 * thing it describes within about two seconds of real use.
 *
 * So this polls on `requestAnimationFrame` rather than composing a
 * ResizeObserver, an IntersectionObserver, a MutationObserver and scroll and
 * resize listeners. One `getBoundingClientRect()` per frame on a single element
 * is cheap (it is a layout read, and it happens before paint, so it forces no
 * extra layout of its own), and it is the only approach that catches all of:
 * scroll, resize, zoom, font load, CSS transition, sibling insertion, the
 * anchor being replaced by a re-render, and the anchor going away entirely.
 * The observer stack catches most of those and needs five teardown paths.
 *
 * Every update goes through the functional form of setState and returns the
 * previous object when nothing moved, so React bails out of the render. A still
 * page costs one rect read per frame and nothing else.
 */
export function useAnchorRect(
  anchor: TourAnchor | undefined,
  active: boolean,
): AnchorTracking {
  const [tracking, setTracking] = useState<AnchorTracking>(() => idle(anchor));

  // Reset during render rather than in an effect when the step moves to a
  // different anchor. This is React's documented "adjusting state when a prop
  // changes" pattern, and the alternative is a frame in which the callout is
  // already showing the new step's copy while the spotlight is still cut
  // around the previous step's element.
  const [trackedAnchor, setTrackedAnchor] = useState(anchor);
  if (trackedAnchor !== anchor) {
    setTrackedAnchor(anchor);
    setTracking(idle(anchor));
  }

  useEffect(() => {
    if (!active || !anchor) return;

    let frame = 0;
    let element: HTMLElement | null = null;
    let scrolledIntoView = false;
    const startedAt = performance.now();

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function tick() {
      frame = requestAnimationFrame(tick);

      // Re-resolve whenever the cached node has left the document or has been
      // hidden. React re-renders replace nodes rather than mutating them, so a
      // cached element goes stale on any parent re-render, and the header nav
      // exists twice (desktop row, mobile sheet) with only one visible at a
      // time: a viewport resize across the lg breakpoint swaps which copy is
      // the real one.
      //
      // getClientRects(), not offsetParent. Both answer "is this element laid
      // out", but offsetParent is also null for an element that is itself
      // `position: fixed`, and the tour now points at one (the AI choice
      // dialog's panel). Under offsetParent that anchor would be declared
      // stale and re-queried on every single frame, for the whole time the
      // dialog is up.
      if (
        !element ||
        !element.isConnected ||
        element.getClientRects().length === 0
      ) {
        element = resolveAnchor(anchor as TourAnchor);
      }

      if (!element) {
        const state: AnchorState =
          performance.now() - startedAt > RESOLVE_GRACE_MS
            ? "missing"
            : "resolving";
        setTracking((prev) =>
          prev.state === state && prev.rect === null && prev.element === null
            ? prev
            : { rect: null, state, element: null },
        );
        return;
      }

      const box = element.getBoundingClientRect();
      const rect: AnchorRect = {
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
      };

      // Bring the target on screen once, the first time it resolves. Not every
      // frame: re-issuing scrollIntoView while a smooth scroll is still
      // animating restarts it, which reads as the page refusing to settle.
      if (!scrolledIntoView) {
        scrolledIntoView = true;
        const offScreen =
          box.top < 96 || box.bottom > window.innerHeight - 96 || box.left < 0;
        if (offScreen) {
          element.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: reduceMotion ? "auto" : "smooth",
          });
        }
      }

      const found = element;
      setTracking((prev) =>
        prev.state === "found" &&
        prev.element === found &&
        same(prev.rect, rect)
          ? prev
          : { rect, state: "found", element: found },
      );
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [anchor, active]);

  return tracking;
}
