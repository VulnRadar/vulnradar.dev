"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Adds the minimum-viable accessibility attributes to a custom-built modal
 * (`role="dialog"`, `aria-modal`, `aria-labelledby`, `aria-describedby`)
 * plus escape-key dismissal and basic focus management.
 *
 * Phase 8 Commit 4: the codebase has ~6 hand-rolled `<div>` modals that
 * lack these attributes. A full migration to `@radix-ui/react-dialog` is
 * deferred (behavior-parity risk per modal). This hook gives screen
 * readers and keyboard users the same semantics without changing the
 * visual layout.
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
