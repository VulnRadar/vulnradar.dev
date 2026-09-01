"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InlineAlert } from "@/components/shared/inline-alert";
import { cn } from "@/lib/ui/utils";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Failure message from the last attempt, rendered above the footer. Half the
   * hand-rolled copies of this dialog had nowhere to put one, so a rejected
   * delete looked exactly like a slow one: the spinner simply stopped.
   */
  error?: string | null;
  /** Set while the caller owns the pending state; otherwise it manages its own. */
  busy?: boolean;
  /** Holds the confirm button closed until an extra guard is satisfied (a typed name). */
  confirmDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  /** Extra content between the description and the footer (a typed-name input, a list). */
  children?: React.ReactNode;
}

/**
 * The one confirmation dialog.
 *
 * Eleven confirmation mechanisms shipped at once, eight of which were ad-hoc
 * rebuilds of this exact AlertDialog with their own header, footer and busy
 * state. Eight copies is eight places to change when the copy, the busy
 * behaviour or the focus handling changes, and it is why some of them could
 * report a failure and others structurally could not.
 *
 * Radix supplies the focus trap, escape dismissal and role="alertdialog", so
 * none of that is maintained here. `busy` is optional: pass it when the caller
 * already tracks the pending flag (most do, to disable a row), otherwise the
 * dialog tracks it around `onConfirm` itself.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  error,
  busy,
  confirmDisabled,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = busy ?? internalBusy;

  async function handleConfirm(e: React.MouseEvent<HTMLButtonElement>) {
    // Radix closes the dialog on an action click by default. Prevented so the
    // spinner stays visible while the action runs and, more importantly, so a
    // failure has somewhere to be shown instead of the dialog vanishing.
    e.preventDefault();
    setInternalBusy(true);
    try {
      await onConfirm();
    } catch {
      // Reported by the caller through `error`.
    } finally {
      setInternalBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isBusy) onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                danger ? "bg-destructive/10" : "bg-primary/10",
              )}
            >
              {danger ? (
                <AlertTriangle
                  aria-hidden="true"
                  className="h-5 w-5 text-destructive"
                />
              ) : (
                <ShieldCheck
                  aria-hidden="true"
                  className="h-5 w-5 text-primary"
                />
              )}
            </div>
            <div className="min-w-0">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription className="text-left">
                {description}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {children}
        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <AlertDialogCancel disabled={isBusy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isBusy || confirmDisabled}
            className={cn(
              "gap-2",
              danger &&
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            )}
          >
            {isBusy && (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            )}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
