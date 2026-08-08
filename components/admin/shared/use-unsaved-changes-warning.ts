"use client";

import { useEffect } from "react";

/** The slice of `BeforeUnloadEvent` this module actually touches. */
export interface UnloadLikeEvent {
  preventDefault(): void;
  returnValue: unknown;
}

/**
 * The slice of `window` this module actually touches, narrowed to a single
 * plain call signature instead of DOM lib's overloaded
 * `WindowEventHandlers["addEventListener"]`. The real `window` satisfies
 * this structurally at the one call site that uses it
 * (`useUnsavedChangesWarning` below); a test can pass a plain mock object
 * without fighting the DOM lib's overload set.
 */
export interface UnloadEventTarget {
  addEventListener(
    type: "beforeunload",
    listener: (event: UnloadLikeEvent) => void,
  ): void;
  removeEventListener(
    type: "beforeunload",
    listener: (event: UnloadLikeEvent) => void,
  ): void;
}

/**
 * Attaches a `beforeunload` listener that warns on an actual page
 * navigation (refresh, close tab, follow a link off the page) while
 * `shouldWarn()` returns true. Pulled out of the hook below as a plain,
 * DOM-injectable function so it is unit-testable: this project's Vitest
 * runs in a plain node environment with no jsdom, so a hook that reaches
 * for the real `window` directly cannot be exercised in a test.
 *
 * Returns a cleanup function that removes the listener it added.
 */
export function attachBeforeUnloadWarning(
  target: UnloadEventTarget,
  shouldWarn: () => boolean,
): () => void {
  const handler = (event: UnloadLikeEvent) => {
    if (!shouldWarn()) return;
    event.preventDefault();
    // Legacy browsers require returnValue to be set to show the prompt.
    event.returnValue = "";
  };

  target.addEventListener("beforeunload", handler);
  return () => target.removeEventListener("beforeunload", handler);
}

/**
 * Warns before the browser navigates away (refresh, close, external link)
 * while there are unsaved changes. Does not intercept in-app tab switches;
 * those are the caller's own state and should simply not discard pending
 * edits rather than warn about losing them.
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // The DOM lib's overloaded addEventListener type does not structurally
    // match UnloadEventTarget's single plain signature; window really does
    // support this call shape, so this is a narrow, deliberate cast rather
    // than fighting the overload set for a two-line integration.
    return attachBeforeUnloadWarning(
      window as unknown as UnloadEventTarget,
      () => hasUnsavedChanges,
    );
  }, [hasUnsavedChanges]);
}
