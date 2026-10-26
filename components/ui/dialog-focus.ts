"use client";

import * as React from "react";

/**
 * Where keyboard focus goes when a dialog closes.
 *
 * Radix's modal Content answers its close-autofocus event with
 * `event.preventDefault(); context.triggerRef.current?.focus()`. The
 * preventDefault switches off FocusScope's own "return to whatever had focus
 * before" and the replacement only works when a `<DialogTrigger>` or
 * `<AlertDialogTrigger>` was rendered. Almost nothing here renders one: every
 * `useConfirm()` call, the profile save modal and the ticket "Close ticket"
 * confirm open from state, so on close there was no trigger to focus and focus
 * fell to <body>. A keyboard user's next Tab started from the top of the
 * document and a screen reader said nothing about where they were (SC 2.4.3).
 *
 * The fix lives in the two shared wrappers, so every call site gets it.
 */

export type AutoFocusHandler = (event: Event) => void;

type CancellableEvent = Pick<Event, "defaultPrevented" | "preventDefault">;

/**
 * The slice of `document` this module reads. Typed as a slice so the logic runs
 * under the node test environment against a plain object (this repo has no DOM
 * test setup).
 */
export interface FocusDocument {
  activeElement: Element | null;
  body: Element | null;
  querySelector(selectors: string): Element | null;
}

/**
 * Radix's own composition rule: the caller's handler runs first, and if it
 * called preventDefault() it has taken over and ours stands down.
 */
export function composeAutoFocus(
  external: AutoFocusHandler | undefined,
  internal: AutoFocusHandler,
): AutoFocusHandler {
  return (event) => {
    external?.(event);
    if (!event.defaultPrevented) internal(event);
  };
}

/** Nothing has focus, which is what the browser reports after the focused node is removed. */
function focusIsFree(doc: FocusDocument): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body;
}

/**
 * The element worth remembering at open. <body> is what `activeElement` is when
 * nothing was focused (Safari does not focus a button on click, and a dialog
 * opened by code has no origin at all), and returning to it is no better than
 * the fallback.
 */
export function rememberableElement(
  el: Element | null,
  doc: FocusDocument,
): HTMLElement | null {
  if (!el || el === doc.body) return null;
  return typeof (el as HTMLElement).focus === "function"
    ? (el as HTMLElement)
    : null;
}

/** Still in the document and not disabled: a disabled button silently refuses focus. */
function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected) return false;
  return !(el as HTMLButtonElement).disabled;
}

/**
 * Focus the page's own heading, for when whatever opened the dialog is gone
 * (the confirmed action removed its row).
 *
 * `preventScroll`: the user was working at some scroll position, often deep in
 * a list, and the heading is at the top. Focus is what screen readers and the
 * next Tab key off; yanking the viewport to the top of the page after every
 * delete is a cost nobody asked for. tabindex="-1" makes a heading focusable
 * from script without putting it in the tab order, and the global
 * :focus-visible rule in app/globals.css skips tabindex="-1", so it paints no
 * ring.
 */
export function focusPageHeading(doc: FocusDocument): boolean {
  const heading = (doc.querySelector("main h1") ??
    doc.querySelector("h1")) as HTMLElement | null;
  if (!heading) return false;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
  return true;
}

export interface CloseFocusOptions {
  /** What had focus when the dialog opened, if anything useful did. */
  origin: HTMLElement | null;
  doc: FocusDocument;
  /** Runs after the current event dispatch, including Radix's own handler. */
  defer?: (fn: () => void) => void;
}

/**
 * The close-autofocus decision, in the order it matters.
 *
 *  1. Focus was already placed somewhere deliberate (the page moved it to the
 *     next row after a delete, or the user clicked on during the exit
 *     animation). Leave it alone, and stop Radix hauling it back to a trigger.
 *  2. The origin is still there and takes focus: go back to it.
 *  3. Otherwise do NOT prevent the default, so a dialog that does have a
 *     trigger still gets Radix's own trigger focus, and then catch whatever is
 *     left on <body> with the page heading.
 */
export function restoreFocusOnClose(
  event: CancellableEvent,
  { origin, doc, defer = queueMicrotask }: CloseFocusOptions,
): void {
  if (!focusIsFree(doc)) {
    event.preventDefault();
    return;
  }
  if (canTakeFocus(origin)) {
    origin.focus();
    if (doc.activeElement === origin) {
      event.preventDefault();
      return;
    }
  }
  defer(() => {
    if (focusIsFree(doc)) focusPageHeading(doc);
  });
}

/**
 * Per-dialog focus memory.
 *
 * `originRef` is filled by <DialogFocusOrigin> at the moment the dialog's
 * portal mounts; `onCloseAutoFocus` is what goes on Radix Content, with the
 * caller's own handler composed in front of it.
 */
export function useDialogFocusRestore(
  callerOnCloseAutoFocus?: AutoFocusHandler,
) {
  const originRef = React.useRef<HTMLElement | null>(null);

  // Composed by hand rather than through composeAutoFocus(): the React Compiler
  // lint refuses a ref-reading function handed to another function during
  // render, and this is the one place that reads one.
  const onCloseAutoFocus: AutoFocusHandler = (event) => {
    // Taken, not just read, and before the caller's handler can bail out: a
    // stale node from this opening must never be restored after a later one
    // that had no origin.
    const origin = originRef.current;
    originRef.current = null;
    callerOnCloseAutoFocus?.(event);
    if (event.defaultPrevented) return;
    restoreFocusOnClose(event, { origin, doc: document });
  };

  return { originRef, onCloseAutoFocus };
}

/**
 * Records `document.activeElement` as the dialog opens.
 *
 * Render this as the FIRST child of the dialog's portal. It cannot be done in
 * onOpenAutoFocus, which is where this was first sketched: FocusScope only
 * dispatches that event when focus is not already inside the dialog, and a
 * dialog with an `autoFocus` input (team create, the admin password confirm)
 * has focus inside before FocusScope's effect runs, so the handler never fires
 * for exactly the dialogs people type into. A layout effect that runs ahead of
 * the panel's own subtree sees the element that really had focus: React
 * commits siblings in order, and a child's `autoFocus` is applied when that
 * child commits, after this component's effect.
 */
export function DialogFocusOrigin({
  originRef,
}: {
  originRef: React.RefObject<HTMLElement | null>;
}) {
  React.useLayoutEffect(() => {
    originRef.current = rememberableElement(document.activeElement, document);
  }, [originRef]);
  return null;
}
