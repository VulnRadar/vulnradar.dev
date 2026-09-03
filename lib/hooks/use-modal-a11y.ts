"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Adds the minimum-viable accessibility attributes to a custom-built modal
 * (`role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`)
 * plus escape-key dismissal and basic focus management.
 *
 * This used to be called directly by roughly a dozen hand-rolled `<div>`
 * modals. It now has three callers, and the shape of that list is the point:
 *
 *  - components/ui/modal-shell.tsx, which is the one non-Radix modal shell.
 *    Everything that used to call this hook itself goes through ModalShell now,
 *    so the a11y wiring and the chrome arrive together instead of a modal being
 *    able to have one without the other.
 *  - components/modals/tos-modal.tsx and components/shared/onboarding-tour.tsx,
 *    which cannot use ModalShell because it closes on a scrim click and both of
 *    those must not (one is a mandatory legal gate, the other burns the tour on
 *    close). Each documents that at its call site.
 *
 * A full migration to `@radix-ui/react-dialog` stays deferred, and now costs
 * less to leave undone: the two remaining direct callers are exactly the two
 * whose dismissal behaviour Radix would have to be argued out of.
 *
 * Usage:
 *   const { dialogProps, titleProps, descriptionProps } =
 *     useModalA11y({ open: openProp, onClose, hasDescription: true });
 *   return (
 *     <div className="fixed inset-0 ...">
 *       <div className="bg-card ..." {...dialogProps}>
 *         <h3 {...titleProps}>Title</h3>
 *         <p {...descriptionProps}>Description</p>
 *       </div>
 *     </div>
 *   );
 */

/**
 * Marks a top-level overlay that a modal must not inert or hide.
 *
 * Spread it onto the outermost element of an overlay that is mounted beside
 * the page (in the root layout) rather than inside it. See the effect below.
 */
export const OVERLAY_PASSTHROUGH = "data-overlay-passthrough";

interface UseModalA11yOptions {
  open: boolean;
  onClose: () => void;
  hasDescription?: boolean;
}

export function useModalA11y({
  open,
  onClose,
  hasDescription = false,
}: UseModalA11yOptions) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  // Escape key: close the modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Hide the rest of the page from assistive tech while the modal is open.
  // The focus-trap comment below has always said the page behind was
  // aria-hidden, but nothing ever set it: a screen-reader user could read
  // straight past the dialog into the page it is supposed to be covering,
  // which is exactly what `aria-modal` promises does not happen.
  //
  // Only top-level body children that do NOT contain the panel are touched,
  // so a modal rendered inline (rather than through a portal) can never hide
  // itself. An element that already carries aria-hidden is left alone, and
  // restored to that state on close, so two stacked modals do not fight over
  // it. `inert` rides along where the browser supports it: it also takes the
  // background out of the tab order and out of pointer events, which is what
  // a modal means.
  //
  // OVERLAY_PASSTHROUGH is the one exception, and it is narrow on purpose.
  // Everything a modal covers is page content, with one exception: an overlay
  // mounted in the root layout is a SIBLING body child, not content behind the
  // dialog, and inerting it kills its own controls for as long as the modal is
  // up. That is not theoretical -- the product tour's callout is such a
  // sibling, and its "End tour" button went dead every time a modal opened over
  // a step. Opted into by attribute rather than by component name so this file
  // keeps knowing nothing about who its neighbours are.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const hidden: HTMLElement[] = [];
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.contains(panel)) continue;
      if (el.hasAttribute(OVERLAY_PASSTHROUGH)) continue;
      if (el.hasAttribute("aria-hidden")) continue;
      el.setAttribute("aria-hidden", "true");
      el.setAttribute("inert", "");
      hidden.push(el);
    }
    return () => {
      for (const el of hidden) {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("inert");
      }
    };
  }, [open]);

  // Focus trap: keep Tab / Shift+Tab cycling inside the modal so a keyboard
  // user can't step out into the (now aria-hidden) page behind it -- an ARIA
  // violation, and for the mandatory ToS gate it reaches controls the gate
  // exists to block. Capture phase so we wrap before focus actually moves.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  // Focus management: on open, save the previously focused element and
  // move focus into the modal. On close, restore focus.
  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    // Defer to the next frame so the modal has rendered.
    const id = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable) {
        focusable.focus();
      } else {
        panel.focus();
      }
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previousActiveRef.current;
      if (prev && typeof prev.focus === "function") {
        prev.focus();
      }
    };
  }, [open]);

  return {
    dialogProps: {
      ref: panelRef,
      role: "dialog" as const,
      "aria-modal": true,
      "aria-labelledby": titleId,
      "aria-describedby": hasDescription ? descriptionId : undefined,
      tabIndex: -1,
    },
    titleProps: {
      id: titleId,
    },
    descriptionProps: hasDescription
      ? { id: descriptionId }
      : ({} as { id?: string }),
  };
}
