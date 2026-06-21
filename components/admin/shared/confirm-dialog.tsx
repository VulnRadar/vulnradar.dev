"use client";

import { useState } from "react";
import { AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/ui/utils";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  children?: React.ReactNode;
}

/**
 * Confirmation dialog for dangerous/important admin actions.
 *
migrated from a hand-rolled `<div>` overlay to
 * `@radix-ui/react-alert-dialog`. Radix provides focus trap, escape-key
 * dismissal, click-outside-to-close, and `aria-modal`/`role="alertdialog"`
 * for free, so screen readers and keyboard users get the right semantics
 * without us maintaining them by hand.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleConfirm = async (e: React.MouseEvent<HTMLButtonElement>) => {
    // Prevent the default form submission / dialog close so the spinner
    // can stay visible while the async action runs.
    e.preventDefault();
    setIsLoading(true);
    try {
      await onConfirm();
    } catch {
      // Error handling is done in the action itself.
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                danger ? "bg-destructive/10" : "bg-primary/10",
              )}
            >
              {danger ? (
                <AlertTriangle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                <ShieldCheck
                  className="h-5 w-5 text-primary"
                  aria-hidden="true"
                />
              )}
            </div>
            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className={cn(
              danger &&
                "bg-destructive hover:bg-destructive/90 text-destructive-foreground",
            )}
          >
            {isLoading && (
              <Loader2
                className="h-4 w-4 mr-2 animate-spin"
                aria-hidden="true"
              />
            )}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
