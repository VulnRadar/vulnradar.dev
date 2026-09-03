"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the tour currently wants the app's own floating chrome out of the
 * way.
 *
 * The problem this solves: the AI assistant's launcher is a 56px filled circle
 * fixed to the bottom-right of every page, and the tour's scrim is a
 * translucent, blurred sheet over the whole viewport. The launcher sits at a
 * lower z-index than the scrim, so it is not on top of the coach mark exactly,
 * it glows through it, which is worse: a bright brand-coloured blob that
 * belongs to no step, next to a callout that is pointing somewhere else. It
 * reads as a rendering fault.
 *
 * Two ways to fix that and only one of them is honest for both cases. Hiding
 * the launcher for the whole tour would mean the tour never explains a
 * significant product surface, and it would also mean the tour cannot point at
 * it. Explaining it in a step needs it visible for exactly those steps. So the
 * tour hides it by default and lifts the suppression for the steps that are
 * about it (TourStep.usesFloatingChrome).
 *
 * Why a store rather than a prop or a context: the widget is lazily imported
 * by components/shared/chat-widget-mount.tsx on idle, and the tour is lazily
 * imported by components/shared/tour/tour-mount.tsx when an account has one to
 * run. They are siblings in the root layout that may mount in either order, or
 * not at all. A module-level subscription lets either side arrive late without
 * the other having to know it exists, and it costs the widget one boolean.
 *
 * Nothing here hides anything permanently. The tour clears the flag when it
 * pauses, when it ends, and on unmount, so a reader who stops the tour gets
 * their launcher back on the next frame.
 */

let suppressed = false;
const listeners = new Set<() => void>();

/** Called by the tour. Idempotent: setting the value it already has is free. */
export function setTourChromeSuppressed(next: boolean): void {
  if (suppressed === next) return;
  suppressed = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return suppressed;
}

/**
 * Server snapshot. Always false, and it has to be: the tour only ever runs in
 * a browser, so the server's answer is "nothing is suppressed" and hydration
 * matches whatever the first client render finds.
 */
function getServerSnapshot(): boolean {
  return false;
}

/** Subscribed by the floating chrome itself. */
export function useTourChromeSuppressed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
