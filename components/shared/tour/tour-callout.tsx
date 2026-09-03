"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  Crosshair,
  MapPin,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { focus as focusRing } from "@/lib/ui/animations";
import { OVERLAY_PASSTHROUGH } from "@/lib/hooks/use-modal-a11y";
import {
  placeCallout,
  type TourPlacement,
  type TourSide,
} from "@/lib/tour/placement";
import type { AnchorRect } from "@/lib/tour/use-anchor-rect";
import { TourProgress } from "./tour-progress";

export interface TourCalloutProps {
  /** Padded, viewport-clipped anchor box. Null centres the callout. */
  rect: AnchorRect | null;
  viewport: { width: number; height: number };
  placement: TourPlacement;
  index: number;
  total: number;
  chapterLabel: string;
  title: string;
  body: string;
  /** Set on a step that is waiting for the reader. Names what it waits for. */
  waitingFor: string | null;
  /** Set when the anchor could not be found. Names where the step lives. */
  missingOn: string | null;
  /**
   * False when the reader is mid-typing in a field. The callout then leaves
   * focus alone and the orchestrator announces the step through a live region
   * instead, so a step that advances as you type does not yank the cursor out
   * of the box you are typing into.
   */
  takeFocus: boolean;
  canGoBack: boolean;
  isLast: boolean;
  /**
   * True when the step is waiting on the reader rather than on being read.
   *
   * Next is not offered on those steps at all. The tour is a chain and every
   * waiting step is a link in it, so stepping over one does not skip a step,
   * it invalidates the rest of the chapter: the URL that was never typed is
   * the scan that never ran is the verdict that is not there to read. Back
   * (to retry) and End tour are the two honest moves, and both stay.
   */
  blocked: boolean;
  onBack: () => void;
  onAdvance: () => void;
  onPause: () => void;
  /** Ends the whole tour and spends it. Rendered on every step, waiting ones
   *  included: an exit that is only offered once the step is satisfied is not
   *  an exit. */
  onEnd: () => void;
  /** Present only when there is a resolved element to send focus to. */
  onFocusAnchor: (() => void) | null;
  /** Present only when the step declares a route we are not on. */
  onGoToRoute: (() => void) | null;
}

/** Width of the callout, before the viewport clamps it on a small screen. */
const CALLOUT_WIDTH = 360;

export function TourCallout({
  rect,
  viewport,
  placement,
  index,
  total,
  chapterLabel,
  title,
  body,
  waitingFor,
  missingOn,
  takeFocus,
  canGoBack,
  isLast,
  blocked,
  onBack,
  onAdvance,
  onPause,
  onEnd,
  onFocusAnchor,
  onGoToRoute,
}: TourCalloutProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const [size, setSize] = useState({ width: CALLOUT_WIDTH, height: 220 });

  // Measured rather than assumed: the copy varies by three lines between the
  // shortest and longest step, and the placement maths needs the real height
  // or a callout below a control near the fold gets clamped upward and covers
  // the thing it is pointing at. useLayoutEffect so the first paint is already
  // in the right place instead of visibly jumping there.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const box = panel.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.width - box.width) < 1 &&
        Math.abs(prev.height - box.height) < 1
          ? prev
          : { width: box.width, height: box.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [title, body, waitingFor, missingOn]);

  // Focus moves to the callout on every step so a screen reader announces the
  // new title and body. Deliberately NOT a focus trap and NOT aria-modal: the
  // premise of the tour is that the reader operates the real page, and both of
  // those would put the highlighted control out of reach of a keyboard. The
  // page behind stays in the tab order, which is why the callout offers an
  // explicit way to jump to the highlighted control instead.
  useEffect(() => {
    if (!takeFocus) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [index, takeFocus]);

  // The side the callout is currently on, fed back into the next placement so
  // it can be sticky. Without it placeCallout decides from scratch on every
  // rect update (which is every animation frame), and an anchor whose height
  // changes by a text line while its own step is on screen -- the scan progress
  // panel does exactly that as each check family reports -- crosses the "does
  // the callout fit below this" threshold repeatedly, throwing the callout from
  // under the anchor to over it and back at frame rate. See SIDE_KEEP_MARGIN.
  //
  // State rather than a ref, and adjusted during render rather than in an
  // effect. It is React's documented shape for a value derived from a prop
  // (the same one useAnchorRect uses to reset itself when the step's anchor
  // changes): setting state during render re-runs this component before
  // anything is committed, so the callout is never painted once on the old
  // side and again on the new one. It converges in a single extra pass,
  // because feeding placeCallout the side it just chose returns that same
  // side by construction.
  //
  // Cleared on a step change rather than carried into it: the next step has
  // its own preferred side and its own anchor, so the last step's choice is
  // not evidence about this one.
  const [side, setSide] = useState<TourSide | undefined>(undefined);
  const [sideForIndex, setSideForIndex] = useState(index);
  if (sideForIndex !== index) {
    setSideForIndex(index);
    setSide(undefined);
  }

  const placed = rect
    ? placeCallout(rect, size, viewport, placement, side)
    : {
        side: "bottom" as const,
        top: Math.max(12, viewport.height / 2 - size.height / 2),
        left: Math.max(12, viewport.width / 2 - size.width / 2),
        arrow: -1,
      };
  if (rect && placed.side !== side) setSide(placed.side);

  // The pointer is a 10px square rotated 45 degrees. `placed.arrow` is where
  // its CENTRE should sit along the anchored edge, so both offsets are half
  // the square: -5 across the edge puts its midline on the panel border, and
  // -5 along the edge converts a centre into a top-left corner.
  const ARROW_HALF = 5;
  const arrowStyle: Record<string, string | number> = {};
  if (rect && placed.arrow >= 0) {
    if (placed.side === "top" || placed.side === "bottom") {
      arrowStyle.left = placed.arrow - ARROW_HALF;
      arrowStyle[placed.side === "bottom" ? "top" : "bottom"] = -ARROW_HALF;
    } else {
      arrowStyle.top = placed.arrow - ARROW_HALF;
      arrowStyle[placed.side === "right" ? "left" : "right"] = -ARROW_HALF;
    }
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      style={{
        top: placed.top,
        left: placed.left,
        width: Math.min(CALLOUT_WIDTH, viewport.width - 24),
      }}
      // The callout is mounted in the root layout, so to a modal opening over
      // the page it looks like a sibling to be inerted along with everything
      // else behind the dialog. It is not: it is the thing holding End tour,
      // and the tour deliberately has a step that runs while a modal is up.
      {...{ [OVERLAY_PASSTHROUGH]: "" }}
      className="fixed z-100 rounded-lg border bg-card shadow-lg outline-hidden"
    >
      {rect && placed.arrow >= 0 && (
        <span
          aria-hidden="true"
          style={arrowStyle}
          className={cn(
            "absolute h-2.5 w-2.5 rotate-45 border bg-card",
            // Only the two edges facing the anchor keep their border, so the
            // square reads as a spur off the panel rather than a diamond
            // stuck to it.
            placed.side === "bottom" && "border-b-0 border-r-0",
            placed.side === "top" && "border-l-0 border-t-0",
            placed.side === "right" && "border-r-0 border-t-0",
            placed.side === "left" && "border-b-0 border-l-0",
          )}
        />
      )}

      {/* A pause glyph, not an X. This chip pauses: it takes the overlay down,
          keeps the step and leaves a resume pill. Drawn as an X it read as
          "close this for good", which is the one thing it does not do, and it
          sent everyone who wanted out of the tour to a pill they then had to
          decode. The exit that ends the tour is worded, in the footer. */}
      <button
        type="button"
        onClick={onPause}
        aria-label="Pause the tour"
        title="Pause the tour"
        className={cn(
          // h-11 w-11 below sm, the app's touch-target floor. At a flat 32px
          // this was the only way to stop a tour and it sat over a scrim.
          "absolute right-2.5 top-2.5 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-8 sm:w-8",
          focusRing.ring,
        )}
      >
        <Pause className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <div className="px-4 pb-3.5 pt-3.5">
        {/* pr-12 clears the larger pause button below sm. */}
        <div className="flex flex-wrap items-center gap-2 pr-12 font-mono text-[10px] uppercase tracking-[0.14em] sm:pr-9">
          {/* A chapter name out of TOUR_CHAPTERS, so nothing to clip for. */}
          <span className="min-w-0 text-primary">{chapterLabel}</span>
          <span aria-hidden="true" className="text-border">
            /
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {index + 1} of {total}
          </span>
        </div>

        <div className="mt-2.5">
          <TourProgress index={index} />
        </div>

        <h2
          id={titleId}
          className="mt-3 text-sm font-semibold tracking-tight text-balance text-foreground"
        >
          {title}
        </h2>
        <p
          id={bodyId}
          className="mt-1.5 text-[13px] leading-relaxed text-pretty text-muted-foreground"
        >
          {body}
        </p>

        {/* The waiting state, spelled out. The alternative is a greyed-out
            Next, which says the tour is stuck without saying why or what would
            unstick it. aria-live so it is announced when the step arrives
            without stealing the announcement of the step itself. */}
        {waitingFor && (
          <div
            aria-live="polite"
            className="mt-3 flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-2.5 py-2"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse motion-reduce:animate-none"
            />
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-foreground">
              {waitingFor}
            </span>
            {onFocusAnchor && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onFocusAnchor}
                className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
              >
                <Crosshair className="h-3 w-3" aria-hidden="true" />
                Focus it
              </Button>
            )}
          </div>
        )}

        {/* The degraded state. A step whose anchor is not on this page says so
            rather than drawing a spotlight on nothing, and carries the way to
            get to where it lives. */}
        {missingOn && (
          <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-2">
            {/* Two different situations wearing one sentence, until now. On
                the wrong page there is somewhere to send the reader and the
                button below does it. On the RIGHT page it means the thing has
                not appeared: a scan that failed, a submit that was rejected, a
                panel still loading. Telling that reader the control "lives on
                /dashboard" while they are standing on /dashboard reads as the
                tour having lost its place, and it names no way out. Back is
                the way out, and it is one button to the left. */}
            <p className="text-[11px] leading-snug text-muted-foreground">
              {onGoToRoute ? (
                <>
                  This control is not on screen right now. It lives on{" "}
                  <span className="font-mono text-foreground">{missingOn}</span>
                  .
                </>
              ) : (
                <>
                  This step is waiting for something that has not turned up. If
                  the last thing you tried did not go through, press Back and
                  take another run at it.
                </>
              )}
            </p>
            {onGoToRoute && (
              <Button
                variant="outline"
                size="sm"
                onClick={onGoToRoute}
                className="h-7 w-fit gap-1.5 bg-transparent px-2 text-[11px]"
              >
                <MapPin className="h-3 w-3" aria-hidden="true" />
                Take me there
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            disabled={!canGoBack}
            className="h-7 gap-1 px-2 text-xs"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* The way out of the whole thing, worded, on every step. Not
              conditional on anything, and now the only user-facing exit
              besides doing what the step asks: a reader who wants to stop is
              most likely to want it on a step that is waiting for them, which
              is exactly where a conditional exit would be missing. */}
          {!isLast && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEnd}
              aria-label="End the tour"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            >
              End tour
            </Button>
          )}

          {/* Only where reading is the whole step. This used to say "Skip
              this" while a step was waiting, which sounded like it skipped one
              step and actually broke the rest of the chapter: the scan that
              was never started is the verdict that is not there to read is the
              finding that cannot be opened. A step that asks for something is
              finished by doing it, by going Back and taking another run at it,
              or by ending the tour. */}
          {!blocked && (
            <Button
              size="sm"
              onClick={onAdvance}
              className="h-7 shrink-0 gap-1 px-2.5 text-xs"
            >
              {isLast ? "Finish" : "Next"}
              {!isLast && (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
