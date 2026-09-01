"use client";

import { useEffect, useRef } from "react";

export interface UseVisibleIntervalOptions {
  /**
   * What to do while the tab is hidden. `null` (the default) stops the timer
   * outright; a number keeps it running at that slower period, which is what
   * a poll tracking a real in-flight job wants so it still notices the job
   * finishing while the user is on another tab.
   */
  hiddenDelayMs?: number | null;
  /**
   * Fire the callback once as soon as the tab becomes visible again. On by
   * default: a poll that was stopped for an hour is an hour stale, and making
   * the user wait out a whole fresh period before the screen catches up is
   * worse than the request it saves.
   */
  runOnVisible?: boolean;
}

/**
 * setInterval that respects tab visibility.
 *
 * Every recurring timer in the app used to keep firing in a backgrounded tab.
 * Browsers throttle setTimeout/setInterval in hidden tabs to roughly once a
 * minute, but they do not cancel the fetch a still-scheduled timer issues, and
 * the slow pollers here (notifications at 5 minutes, queue status at 45
 * seconds) are already slower than that throttle floor, so they ran completely
 * unthrottled: an authenticated, database-backed request floor proportional to
 * open tabs rather than to active users.
 *
 * `delayMs` of `null` disables the timer entirely, so a caller can express
 * "not polling right now" without branching around the hook.
 */
export function useVisibleInterval(
  callback: () => void,
  delayMs: number | null,
  options: UseVisibleIntervalOptions = {},
): void {
  const { hiddenDelayMs = null, runOnVisible = true } = options;

  // Held in a ref so an inline arrow function does not restart the timer on
  // every render: the interval's period is the dependency, not the body.
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    // Guards the catch-up call below. On mount the tab is normally already
    // visible and the caller has just fetched for itself, so only a real
    // hidden -> visible transition should force an extra request.
    let wasHidden = false;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const start = (ms: number) => {
      stop();
      timer = setInterval(() => savedCallback.current(), ms);
    };

    const apply = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        if (hiddenDelayMs === null) stop();
        else start(hiddenDelayMs);
        return;
      }
      const returning = wasHidden;
      wasHidden = false;
      if (returning && runOnVisible) savedCallback.current();
      start(delayMs);
    };

    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      stop();
    };
  }, [delayMs, hiddenDelayMs, runOnVisible]);
}
