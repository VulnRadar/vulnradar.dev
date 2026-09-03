"use client";

import { cn } from "@/lib/ui/utils";
import type { AnchorRect } from "@/lib/tour/use-anchor-rect";

/**
 * The scrim, and the hole in it.
 *
 * Four panels rather than one element with a `box-shadow: 0 0 0 9999px` ring,
 * which is the trick most coach-mark snippets use and which breaks in exactly
 * the places this tour needs to work. A spread that large is clipped by the
 * nearest ancestor with a transform or a filter (the app has both, on the
 * sticky header and on every backdrop-blurred surface), it paints outside the
 * viewport so it cannot be blurred sensibly, and there is no honest way to make
 * it stop at the document edge. Four rectangles are boring and always right:
 * geometry, not a shadow, so the hole is exactly the hole.
 *
 * It also solves the interactivity requirement for free. The highlighted
 * element is not covered by anything, so it stays clickable, focusable and
 * hoverable with no pointer-events juggling; everything else is under a real
 * element that swallows the click. A mask would have needed
 * `pointer-events: none` plus a second blocking layer to get the same result.
 *
 * Not `bg-black/...`: --background is a light grey in the light theme, so a
 * black scrim reads as a different product between themes. This is the same
 * decision components/ui/modal-grammar.ts documents for modals, at a lower
 * opacity because a tour is meant to leave the app legible behind it while a
 * modal is meant to take it away.
 */
const PANEL = "fixed z-90 bg-background/75 backdrop-blur-xs";

interface TourSpotlightProps {
  /** Already padded and clipped to the viewport. Null draws a plain scrim. */
  rect: AnchorRect | null;
  /** Corner radius, in px, copied from the element being highlighted. */
  radius: number;
  /** True while the step is waiting on the reader to do something. */
  waiting: boolean;
  viewport: { width: number; height: number };
}

export function TourSpotlight({
  rect,
  radius,
  waiting,
  viewport,
}: TourSpotlightProps) {
  if (!rect) {
    return <div className={cn(PANEL, "inset-0")} aria-hidden="true" />;
  }

  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;

  return (
    <>
      <div
        aria-hidden="true"
        className={cn(PANEL, "left-0 right-0 top-0")}
        style={{ height: Math.max(0, rect.top) }}
      />
      <div
        aria-hidden="true"
        className={cn(PANEL, "bottom-0 left-0 right-0")}
        style={{ height: Math.max(0, viewport.height - bottom) }}
      />
      <div
        aria-hidden="true"
        className={cn(PANEL, "left-0")}
        style={{
          top: rect.top,
          height: rect.height,
          width: Math.max(0, rect.left),
        }}
      />
      <div
        aria-hidden="true"
        className={cn(PANEL, "right-0")}
        style={{
          top: rect.top,
          height: rect.height,
          width: Math.max(0, viewport.width - right),
        }}
      />

      {/* The ring. Its own element so it can sit above the panels without
          being one of them, and pointer-events-none so it never intercepts a
          click meant for the control it is drawn around. The inset shadow
          keeps a 1px separation between the ring and a control whose own
          border is the same blue. */}
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none fixed z-91 border-2 border-primary",
          "shadow-[0_0_0_1px_hsl(var(--background)),0_0_30px_-6px_hsl(var(--primary))]",
          // Opacity only, so nothing moves: prefers-reduced-motion is honoured
          // globally in app/globals.css by clamping animation-duration, which
          // freezes this at full strength rather than removing the ring. The
          // explicit motion-reduce is belt and braces for that.
          waiting && "animate-pulse motion-reduce:animate-none",
        )}
        style={{
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          borderRadius: radius,
        }}
      />
    </>
  );
}
