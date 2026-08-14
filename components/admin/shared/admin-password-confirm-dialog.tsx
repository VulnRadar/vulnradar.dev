"use client";

import * as React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
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
      <AlertDialogContent className="sm:max-w-md border-border/60">
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
              <AlertTriangle
                className={cn(
                  "h-5 w-5",
                  variant === "destructive"
                    ? "text-destructive"
                    : "text-primary",
                )}
                aria-hidden="true"
              />
            </div>
            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-2 px-1">
          <Label htmlFor={inputId}>Your password</Label>
          <Input
            id={inputId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleConfirm();
              }
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

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
