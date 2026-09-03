"use client";

import { cn } from "@/lib/ui/utils";
import { chapterSpans, TOUR_CHAPTERS, TOUR_STEPS } from "@/lib/tour/steps";

/**
 * The progress rail.
 *
 * A dot per step is the default answer and it is useless past about eight:
 * thirty-six identical dots tell a reader nothing except that this will take a
 * while. One segment per chapter, each segment sized to the number of steps in
 * that chapter, encodes something true instead. The widths say where the bulk
 * of the tour is, the filled portion says how far into the current chapter you
 * are, and the labelled current segment says what you are being shown.
 *
 * Non-interactive on purpose. The obvious next move is to make each segment a
 * jump target, but chapters live on different routes and half of them depend
 * on a scan existing, so a click that lands you three routes away pointing at
 * nothing is a worse affordance than none. Moving on is the footer's job.
 */
export function TourProgress({ index }: { index: number }) {
  const spans = chapterSpans();
  const current = TOUR_STEPS[index].chapter;

  return (
    <div
      role="progressbar"
      aria-label="Tour progress"
      aria-valuemin={1}
      aria-valuemax={TOUR_STEPS.length}
      aria-valuenow={index + 1}
      aria-valuetext={`Step ${index + 1} of ${TOUR_STEPS.length}, ${
        TOUR_CHAPTERS.find((c) => c.id === current)?.label
      }`}
      className="flex items-center gap-1"
    >
      {spans.map((span) => {
        const done = Math.min(Math.max(index - span.start, 0), span.size);
        const active = span.id === current;
        return (
          <span
            key={span.id}
            style={{ flexGrow: span.size }}
            className={cn(
              "h-[3px] overflow-hidden rounded-full",
              active ? "bg-primary/25" : "bg-border",
            )}
          >
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${(done / span.size) * 100}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
