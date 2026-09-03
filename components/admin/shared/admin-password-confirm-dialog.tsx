"use client";

import * as React from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/ui/utils";

export interface AdminPasswordConfirmResult {
  ok: boolean;
  error?: string;
}

export interface AdminPasswordConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
  /** Runs the gated action with the entered password. Returning `ok: false`
   * keeps the dialog open with `error` shown so the admin can retry. */
  onConfirm: (password: string) => Promise<AdminPasswordConfirmResult>;
}

/**
 * Password re-entry gate for admin actions the backend requires re-auth
 * for (see GATED_ACTIONS in app/api/v3/admin/route.ts). Modeled on the
 * confirm dialog in components/admin/features/updater-manager.tsx.
 */
export function AdminPasswordConfirmDialog({
  open,
  onOpenChange,
  title,
  description = "Re-enter your password to confirm this action.",
  confirmLabel = "Confirm",
  variant = "default",
  onConfirm,
}: AdminPasswordConfirmDialogProps) {
  const inputId = React.useId();
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form when the dialog's open prop transitions to true, gated by that dependency so it doesn't run on every render
      setPassword("");
      setError(null);
    }
  }, [open]);

  const handleCancel = () => {
    if (submitting) return;
    setPassword("");
    setError(null);
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (password.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm(password);
      if (result.ok) {
        setPassword("");
      } else {
        setError(result.error || "Something went wrong. Try again.");
      }
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
              {/* A blue warning triangle is a mixed signal: the glyph says
                  "something is wrong" while the colour says "routine". A
                  non-destructive re-auth is a lock, and only the destructive
                  variant gets the triangle. */}
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

        <AlertDialogBody className="space-y-2">
          <Label htmlFor={inputId}>Your password</Label>
          <Input
            id={inputId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            // a11y (SC 1.3.1 / 3.3.1): "Incorrect password" was a plain <p>
            // under the field with no association and no live region, so a
            // screen-reader user re-authenticating for a destructive admin
            // action was told nothing when it failed.
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
          {error && (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
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
            disabled={submitting || password.length === 0}
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
