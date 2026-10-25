import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Moving focus after a view swaps, for screens that swap views in place.
 *
 * The ticket screens replace one block of UI with another (the list with a
 * thread, a button with a form) without navigating. Whatever had focus is
 * removed from the DOM, the browser parks focus on <body>, and a keyboard or
 * screen-reader user is left at the top of the page with no announcement of
 * what changed. WCAG 2.4.3 wants focus to land somewhere that makes sense.
 *
 * The control to focus often does not exist yet when the click handler runs:
 * the thread heading is rendered only after the fetch resolves. So the handler
 * records an INTENT, and an effect that runs after every render looks for the
 * target and focuses it the first render it appears in. Targets are named with
 * `data-focus-id` rather than refs, because a list row's ref would be one of
 * hundreds and the row may not be mounted at all.
 */

/** One or more ids, tried in order: the first that is on screen wins. */
export type FocusTarget = string | readonly string[];

interface FocusableElement {
  focus(options?: { preventScroll?: boolean }): void;
  ownerDocument?: { activeElement: unknown };
}

/** The slice of an element this needs, so a test can stand in for the DOM. */
export interface FocusRoot {
  querySelector(selector: string): unknown;
}

/**
 * How long an intent waits for its target before it is dropped. Long enough
 * for a slow thread to load; short enough that an intent whose target never
 * comes (a failed load) cannot take focus minutes later, from somewhere the
 * user has since moved on to.
 */
export const FOCUS_INTENT_TTL_MS = 5000;

/** How often a waiting intent looks again between renders. */
export const FOCUS_INTENT_RETRY_MS = 150;

export function focusSelector(id: string): string {
  // Ids are written in this repo, never taken from users or the network, but
  // the attribute selector is still built defensively.
  return `[data-focus-id="${id.replace(/["\\]/g, "\\$&")}"]`;
}

/**
 * Focus the first target that exists under `root` and ends up holding focus.
 *
 * "Ends up holding" is the point of the last check. A modal dialog's focus trap
 * hands focus straight back to the dialog, so calling focus() on a control
 * behind it is not the same as moving there. Reporting that as done would use
 * the intent up on a refusal; reporting it as not done keeps it waiting for the
 * render after the dialog closes. With no document to ask (a test double) the
 * call is taken at its word.
 */
export function applyFocusIntent(
  root: FocusRoot | null,
  target: FocusTarget,
): boolean {
  if (!root) return false;
  const ids = typeof target === "string" ? [target] : target;
  for (const id of ids) {
    const element = root.querySelector(
      focusSelector(id),
    ) as FocusableElement | null;
    if (!element || typeof element.focus !== "function") continue;
    element.focus();
    const active = element.ownerDocument?.activeElement;
    if (active === undefined || active === element) return true;
  }
  return false;
}

export interface PendingFocus {
  target: FocusTarget;
  /** Date.now() when the intent was recorded. */
  since: number;
}

/**
 * One look at a pending intent. Returns what is still pending afterwards:
 * nothing when it was satisfied or has expired, the same intent when its
 * target is not there yet.
 */
export function stepFocusIntent(
  pending: PendingFocus | null,
  root: FocusRoot | null,
  now: number,
): PendingFocus | null {
  if (!pending) return null;
  if (now - pending.since > FOCUS_INTENT_TTL_MS) return null;
  return applyFocusIntent(root, pending.target) ? null : pending;
}

/**
 * Returns `focusOn(target)`. Call it from the handler that changes the view;
 * the next render that contains a target takes focus, once. `focusOn(null)`
 * cancels a pending intent (a failed load has nothing to focus), and a newer
 * intent replaces an older one.
 */
export function useFocusIntent(
  rootRef: RefObject<FocusRoot | null>,
): (target: FocusTarget | null) => void {
  const pending = useRef<PendingFocus | null>(null);

  // No dependency list on purpose: the target appears in whichever render
  // happens to mount it, and a missed render is a missed focus.
  //
  // When the target is not there on this render the intent also keeps trying
  // on a short timer. A dialog that is closing holds focus until its exit
  // finishes, and nothing in this component renders again when it does, so
  // waiting for the next render alone would never come.
  useEffect(() => {
    if (pending.current === null) return;
    const step = (): boolean => {
      pending.current = stepFocusIntent(
        pending.current,
        rootRef.current,
        Date.now(),
      );
      return pending.current === null;
    };
    if (step()) return;
    const timer = setInterval(() => {
      if (step()) clearInterval(timer);
    }, FOCUS_INTENT_RETRY_MS);
    return () => clearInterval(timer);
  });

  return useCallback((target: FocusTarget | null) => {
    pending.current = target === null ? null : { target, since: Date.now() };
  }, []);
}
