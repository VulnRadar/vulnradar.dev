"use client";

import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

/**
 * Ask before doing it, in three lines instead of thirty.
 *
 * The rule this exists to make cheap: **anything that modifies, clears or
 * destroys data asks first**, on the user side and in the admin panel. The
 * shared ConfirmDialog already made the dialog itself one component, but every
 * call site still had to carry its own `useState` for the pending target, its
 * own busy flag, its own error string, and its own "close on success, stay
 * open on failure" wiring. That is about twenty lines per action, which is why
 * roughly thirty controls across the product were still firing straight from
 * the click: the gap was never the dialog, it was the bookkeeping.
 *
 * Usage:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   ...
 *   onClick={() =>
 *     confirm({
 *       title: "Fail the stuck scans?",
 *       description: "...",
 *       confirmLabel: "Fail them",
 *       danger: true,
 *       onConfirm: () => sweepStale(),
 *     })
 *   }
 *   ...
 *   {confirmDialog}
 *
 * `onConfirm` may be async. While it runs the dialog shows its busy state; it
 * closes when the promise resolves and STAYS OPEN with the thrown message when
 * it rejects, so a failed delete can never look like a completed one. A
 * handler that reports failure by returning rather than throwing should throw
 * instead, or pass `false` back: returning `false` keeps the dialog open with
 * the generic message.
 */
export interface ConfirmRequest {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, for anything that destroys or removes. */
  danger?: boolean;
  /** Extra content between the description and the footer (a typed name, a list). */
  children?: React.ReactNode;
  /** Holds the confirm button closed until a guard is satisfied. */
  confirmDisabled?: boolean;
  /**
   * The thing itself. Throw (or return false) to keep the dialog open and show
   * why.
   */
  onConfirm: () => void | boolean | Promise<void | boolean>;
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    setError(null);
    setBusy(false);
    setRequest(next);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    setError(null);
    setBusy(false);
  }, []);

  const run = useCallback(async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await request.onConfirm();
      if (outcome === false) {
        setError("That did not go through. Try again.");
        return;
      }
      setRequest(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "That did not go through. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [request]);

  const confirmDialog = request ? (
    <ConfirmDialog
      open
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      danger={request.danger}
      busy={busy}
      error={error}
      confirmDisabled={request.confirmDisabled}
      onConfirm={run}
      onCancel={close}
    >
      {request.children}
    </ConfirmDialog>
  ) : null;

  return { confirm, confirmDialog, confirmBusy: busy };
}
