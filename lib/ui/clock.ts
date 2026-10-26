"use client";

// Reading the clock outside render.
//
// React treats a component's render as a pure function of its props and
// state, and the React Compiler's purity rule (oxlint react/purity) rejects
// `new Date()` and `Date.now()` inside one: a re-render can then disagree
// with the last one about what time it is, and a server render can disagree
// with hydration. Two shapes cover every use in the app:
//
// - a value needed when the user does something (an export's file name):
//   read it in the handler with todayStamp();
// - a value the render depends on (is this share link expired, is this gift
//   still active): subscribe to it with useNow(), which changes on a timer
//   rather than on every render.

import { useSyncExternalStore } from "react";

/** Today's date as YYYY-MM-DD (UTC), for file names. Call it in a handler. */
export function todayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** The current instant as an ISO string, for a payload built in a handler. */
export function nowIso(): string {
  return new Date().toISOString();
}

const TICK_MS = 60_000;

let snapshot = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  snapshot = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(tick, TICK_MS);
    // The snapshot may be minutes old if nothing was subscribed in between.
    tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const getSnapshot = () => snapshot;

/**
 * The current time in epoch milliseconds, refreshed once a minute while any
 * component reads it. Minute resolution is enough for "is this expired"
 * decisions and keeps a page from re-rendering every second.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
