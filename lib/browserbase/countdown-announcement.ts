import { plural } from "@/lib/ui/plural";

/**
 * What a screen reader is told about the session clock, which is not the clock.
 *
 * The visible countdown changes every second; announcing each change is noise
 * that buries everything else, and announcing none leaves a keyboard or
 * screen-reader user with no warning before the session is torn down. So the
 * announcement is a function of a coarse stage, not of the second: it changes
 * only when the stage does, or when an extension changes how long the session
 * lasts.
 */
export const ANNOUNCE_WARNING_SECONDS = 30;
export const ANNOUNCE_FINAL_SECONDS = 10;

export type CountdownStage = "running" | "warning" | "final" | "ended";

export function countdownStage(remainingSeconds: number): CountdownStage {
  if (remainingSeconds <= 0) return "ended";
  if (remainingSeconds <= ANNOUNCE_FINAL_SECONDS) return "final";
  if (remainingSeconds <= ANNOUNCE_WARNING_SECONDS) return "warning";
  return "running";
}

export function countdownAnnouncement(
  remainingSeconds: number,
  minutesAllocated: number,
): string {
  switch (countdownStage(remainingSeconds)) {
    case "ended":
      return "Session ended";
    case "final":
      return `${ANNOUNCE_FINAL_SECONDS} seconds left in this session`;
    case "warning":
      return `${ANNOUNCE_WARNING_SECONDS} seconds left in this session`;
    default:
      return minutesAllocated <= 1
        ? "Session lasts 1 minute"
        : `Session extended to ${minutesAllocated} ${plural(minutesAllocated, "minute")}`;
  }
}
