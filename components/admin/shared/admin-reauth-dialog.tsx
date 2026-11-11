"use client";

import * as React from "react";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/shared/inline-alert";
import { EmailStepUp } from "@/components/shared/email-step-up";
import { cn } from "@/lib/ui/utils";
import {
  AdminPasswordConfirmDialog,
  type AdminPasswordConfirmResult,
} from "./admin-password-confirm-dialog";

/**
 * Whether the signed-in account has a password, from /auth/me.
 *
 * Read defensively: the field is on the response (lib/auth/me.ts) but not yet
 * on MeResponse, and an unknown answer is treated as "has one", which only
 * means the password field is shown and the server still decides.
 */
export function meHasPassword(me: unknown): boolean {
  return (me as { hasPassword?: unknown } | null)?.hasPassword !== false;
}

export interface AdminReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the action does. The dialog adds how to confirm it. */
  description: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
  /** From meHasPassword(me). */
  hasPassword: boolean;
  /**
   * Runs the gated action. `password` is undefined for an account with no
   * password: it confirms with a code mailed to its address instead, and the
   * server reads the step-up that left behind, so nothing is sent for it.
   * Returning `ok: false` keeps the dialog open with `error` shown.
   */
  onConfirm: (
    password: string | undefined,
  ) => Promise<AdminPasswordConfirmResult>;
}

/**
 * The re-authentication gate for admin actions, for both kinds of account.
 *
 * An admin created through Google, GitHub or Discord has no password, and
 * the server now refuses such an account's staff invite or update until it
 * has entered a code from its email (lib/auth/reauth.ts). The password dialog
 * offered it a field it had nothing to type into, so every one of those
 * actions ended in a refusal. Such an account gets EmailStepUp where the
 * field would be, and Confirm waits for it.
 */
export function AdminReauthDialog({
  hasPassword,
  description,
  onConfirm,
  ...rest
}: AdminReauthDialogProps) {
  if (hasPassword) {
    return (
      <AdminPasswordConfirmDialog
        {...rest}
        description={`${description} Re-enter your password to confirm.`}
        onConfirm={(password) => onConfirm(password)}
      />
    );
  }
  return (
    <StepUpConfirmDialog
      {...rest}
      description={description}
      onConfirm={() => onConfirm(undefined)}
    />
  );
}

function StepUpConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "default",
  onConfirm,
}: Omit<AdminReauthDialogProps, "hasPassword" | "onConfirm"> & {
  onConfirm: () => Promise<AdminPasswordConfirmResult>;
}) {
  const idPrefix = React.useId();
  const [ready, setReady] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- resets the step when the dialog's open prop transitions to true, gated by that dependency so it doesn't run on every render
      setReady(false);
      setError(null);
    }
  }, [open]);

  const handleCancel = () => {
    if (submitting) return;
    setError(null);
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm();
      if (!result.ok)
        setError(result.error || "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                variant === "destructive"
                  ? "bg-destructive/10"
                  : "bg-primary/10",
              )}
            >
              {variant === "destructive" ? (
                <AlertTriangle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
              )}
            </div>
            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <AlertDialogBody className="space-y-3">
          <EmailStepUp
            idPrefix={`${idPrefix}-step-up`}
            onReady={() => setReady(true)}
          />
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
        </AlertDialogBody>

        <AlertDialogFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            disabled={submitting || !ready}
            onClick={handleConfirm}
          >
            {submitting && (
              <Loader2
                className="h-4 w-4 mr-2 animate-spin"
                aria-hidden="true"
              />
            )}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
