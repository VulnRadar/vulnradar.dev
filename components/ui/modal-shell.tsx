"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/ui/utils";
import { useModalA11y } from "@/lib/hooks/use-modal-a11y";
import {
  modalBand,
  modalCloseChip,
  modalPanel,
  modalPositioner,
  modalScrim,
  modalSize,
  modalTier,
  type ModalSize,
} from "@/components/ui/modal-grammar";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  /** Rendered under the title and wired to aria-describedby. */
  description?: React.ReactNode;
  /** Optional mark to the left of the title (a status chip, an avatar). */
  icon?: React.ReactNode;
  size?: ModalSize;
  /** Footer band content. Omit for a read-only detail panel. */
  footer?: React.ReactNode;
  /** Body padding is owned by the band; pass a className only to change it. */
  bodyClassName?: string;
  /**
   * Extra data attributes for the panel element.
   *
   * Exists for the product tour, which cuts its spotlight around a real DOM
   * node and finds it by `data-tour`. For a modal that node is the panel, and
   * the panel is the one element a caller cannot reach: this component owns
   * it. Narrowed to `data-*` so it stays a labelling channel and cannot be
   * used to smuggle in a second className, onClick or ref that would fight
   * with the ones below.
   */
  panelProps?: Record<`data-${string}`, string>;
  children: React.ReactNode;
}

/**
 * The three-band modal for surfaces that are not Radix dialogs.
 *
 * Seven `<div className="fixed inset-0">` overlays lived in the admin area,
 * each painting its own `bg-black/60` scrim (which inverts against the light
 * theme, see modal-grammar.ts), its own `rounded-xl` panel, and its own close
 * button drawn variously as an `X` icon, a bare `×` glyph, or nothing at all.
 * They are all this component now, so they are pixel-identical to a
 * DialogContent without being ported to Radix.
 *
 * Why not just port them to Radix: these are click-outside-to-close panels
 * rendered inline inside a data table, several of them stacked on top of an
 * already-open Radix dialog. Moving them into a portal changes their z-order
 * and their close semantics, which is a behaviour change disguised as a style
 * change. `useModalA11y` already gives them the focus trap, Escape handling,
 * background `inert` and focus restoration that Radix would, so the only thing
 * they were missing was the chrome, and that is what this supplies.
 */
export function ModalShell({
  open,
  onClose,
  title,
  description,
  icon,
  size = "md",
  footer,
  bodyClassName,
  panelProps,
  children,
}: ModalShellProps) {
  const { dialogProps, titleProps, descriptionProps } = useModalA11y({
    open,
    onClose,
    hasDescription: description !== undefined,
  });

  if (!open) return null;

  return (
    // Presentational: the scrim is a convenience for pointer users, and the one
    // action it offers (close) is also on the keyboard-reachable button below
    // and on Escape, which useModalA11y binds. That is why it carries no role
    // and no key handler of its own.
    <div className={cn(modalScrim, modalPositioner)} onClick={onClose}>
      <div
        className={cn(modalPanel, modalTier.shell, modalSize[size])}
        onClick={(e) => e.stopPropagation()}
        {...panelProps}
        {...dialogProps}
      >
        <div className={cn(modalBand.header, "pr-12")}>
          <div className="flex items-center gap-2.5">
            {icon}
            <h2
              className="min-w-0 text-base font-semibold leading-tight tracking-tight text-foreground"
              {...titleProps}
            >
              {title}
            </h2>
          </div>
          {description !== undefined && (
            <p
              className="text-sm leading-relaxed text-muted-foreground"
              {...descriptionProps}
            >
              {description}
            </p>
          )}
        </div>

        <div className={cn(modalBand.body, bodyClassName)}>{children}</div>

        {footer !== undefined && (
          <div className={modalBand.footer}>{footer}</div>
        )}

        <button
          type="button"
          onClick={onClose}
          className={modalCloseChip}
          aria-label="Close"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
