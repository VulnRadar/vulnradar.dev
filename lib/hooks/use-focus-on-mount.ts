"use client";

import { useEffect, useRef } from "react";

/**
 * Whether a script may move focus without taking it from somebody.
 *
 * When a view replaces the one the person was working in (the scan form
 * becoming the scanning view, the scanning view becoming the result) the
 * control they were on is unmounted and the browser drops focus on <body>. That
 * is the case worth repairing. Focus sitting on a real element means the
 * person has moved on their own, to the header or to a Cancel button they
 * tabbed to, and it is not ours to take back.
 */
export function canTakeFocus(
  active: Element | null,
  body: Element | null,
): boolean {
  return !active || active === body;
}

/**
 * Move focus into a view that has just replaced the one the person was in.
 *
 * Without this a keyboard or screen reader user who submitted a form lands on
 * <body> in the middle of a new screen and has to Tab from the top of the page
 * to reach anything in it. Returns the ref to put on the element that should
 * receive focus (give a non-interactive one `tabIndex={-1}`), or on a wrapper
 * when `pick` names the element inside it.
 *
 * `enabled` is for a heading that only sometimes wants focus (the auth screens
 * pass it down as a prop). It is read when the view mounts and again when it
 * flips, so a heading that turns it on later is focused then; `pick` is not a
 * dependency, it is only ever called with the root that is already there.
 *
 * `preventScroll` is for content that arrives where the person is already
 * looking (a batch appended under a "load more" button): focus is what screen
 * readers and the next Tab key off, and moving the viewport to it is a cost
 * nobody asked for.
 */
export function useFocusOnMount<T extends HTMLElement>(
  pick?: (root: T) => HTMLElement | null,
  { enabled = true, preventScroll = false } = {},
) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!enabled) return;
    const root = ref.current;
    if (!root) return;
    if (!canTakeFocus(document.activeElement, document.body)) return;
    (pick ? pick(root) : root)?.focus({ preventScroll });
    // This is about the view appearing, not about later renders.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return ref;
}
