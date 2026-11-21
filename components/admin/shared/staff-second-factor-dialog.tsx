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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAlert } from "@/components/shared/inline-alert";
import { EmailStepUp, stepUpCanSave } from "@/components/shared/email-step-up";
import { useAuth, type MeResponse } from "@/components/providers/auth-provider";
import { useClientConfig } from "@/lib/hooks/use-client-config";
import { ROUTES } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import {
  SECOND_FACTOR_MESSAGES,
  isSecondFactorKind,
  type SecondFactorKind,
} from "@/lib/auth/staff-second-factor-kind";
import { meHasPassword } from "./admin-reauth-dialog";

/**
 * The confirmation in front of applying an update and starting an
 * impersonation: the password (or, for an account with none, the mailed
 * step-up), then a second factor (lib/auth/staff-step-up.ts). The server asks
 * for that factor whatever ENFORCE_STAFF_2FA says, so the dialog asks for it
 * too rather than letting the first attempt fail.
 *
 * Which factor comes from /auth/me. When a refusal names a different one
 * (`secondFactor` on the 403, say two-factor was switched off in another tab)
 * the dialog switches to it, and it stays open with the message either way.
 */

export interface StaffSecondFactorCredentials {
  /** Undefined for an account with no password: its step-up cookie stands in. */
  password: string | undefined;
  /** Six digits from the authenticator app, for a `totp` account only. */
  totpCode: string | undefined;
}

export interface StaffSecondFactorResult {
  ok: boolean;
  error?: string;
  /** From the 403's body, when the server refused the second factor. */
  secondFactor?: unknown;
}

/** The factor the signed-in account will be asked for, from /auth/me. */
export function secondFactorFor(
  me:
    | Partial<
        Pick<MeResponse, "totpEnabled" | "twoFactorMethod" | "hasPassword">
      >
    | null
    | undefined,
  hasPassword: boolean = meHasPassword(me),
): SecondFactorKind {
  // Not loaded yet: show the code field and let the server decide, which is
  // what meHasPassword does for the password field.
  if (!me || me.totpEnabled === undefined) return "totp";
  if (me.totpEnabled !== true) return "none";
  if (me.twoFactorMethod === "email") {
    return hasPassword ? "email" : "authenticator";
  }
  return "totp";
}

/** The refusal shown in place of the form, or null when the form can go ahead. */
export function blockedMessage(
  factor: SecondFactorKind,
  emailConfigured: boolean,
): string | null {
  if (factor === "none") return SECOND_FACTOR_MESSAGES.none;
  if (factor === "authenticator") return SECOND_FACTOR_MESSAGES.authenticator;
  if (factor === "email" && !emailConfigured) {
    return SECOND_FACTOR_MESSAGES.noMail;
  }
  return null;
}

const SIX_DIGITS = /^\d{6}$/;

export interface StaffSecondFactorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What the action does. The fields below it say how to confirm. */
  description: string;
  confirmLabel?: string;
  variant?: "default" | "destructive";
  /**
   * meHasPassword(me), when the caller already has it. Read from /auth/me
   * here when it is left out.
   */
  hasPassword?: boolean;
  /** Runs the action. Returning `ok: false` keeps the dialog open with `error`. */
  onConfirm: (
    credentials: StaffSecondFactorCredentials,
  ) => Promise<StaffSecondFactorResult>;
}

export function StaffSecondFactorDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "default",
  hasPassword: hasPasswordProp,
  onConfirm,
}: StaffSecondFactorDialogProps) {
  const idPrefix = React.useId();
  const { me } = useAuth();
  const { emailConfigured } = useClientConfig();
  const hasPassword = hasPasswordProp ?? meHasPassword(me);

  const [password, setPassword] = React.useState("");
  const [totpCode, setTotpCode] = React.useState("");
  const [firstStepUpDone, setFirstStepUpDone] = React.useState(false);
  const [emailFactorDone, setEmailFactorDone] = React.useState(false);
  // Remounts the mailed second factor, back at "Email me a code".
  const [emailFactorRound, setEmailFactorRound] = React.useState(0);
  const [named, setNamed] = React.useState<SecondFactorKind | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect -- resets the form when the dialog's open prop transitions to true, gated by that dependency so it doesn't run on every render
      setPassword("");
      setTotpCode("");
      setFirstStepUpDone(false);
      setEmailFactorDone(false);
      setNamed(null);
      setError(null);
    }
  }, [open]);

  const factor = named ?? secondFactorFor(me, hasPassword);
  const blocked = blockedMessage(factor, emailConfigured);

  const firstReady = hasPassword
    ? password.length > 0
    : stepUpCanSave(emailConfigured, firstStepUpDone);
  const secondReady =
    factor === "totp" ? SIX_DIGITS.test(totpCode) : emailFactorDone;
  const canConfirm = !blocked && firstReady && secondReady && !submitting;

  const handleCancel = () => {
    if (submitting) return;
    setError(null);
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await onConfirm({
        password: hasPassword ? password : undefined,
        totpCode: factor === "totp" ? totpCode : undefined,
      });
      if (result.ok) return;
      // A code is spent or wrong either way; a fresh one goes in next.
      setTotpCode("");
      const next = isSecondFactorKind(result.secondFactor)
        ? result.secondFactor
        : null;
      if (next) setNamed(next);
      // The server found no step-up for this session: the ten minutes ran out
      // or the code never landed. Showing "Confirmed" over that refusal would
      // leave nothing to click but a Confirm that fails the same way.
      if (next === "email") {
        setEmailFactorDone(false);
        setEmailFactorRound((round) => round + 1);
      }
      // A refusal that leaves nothing to type is shown once, in place of the
      // form, not again underneath it.
      setError(
        next && blockedMessage(next, emailConfigured)
          ? null
          : result.error || "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void handleConfirm();
  };

  const errorId = `${idPrefix}-error`;

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

        <AlertDialogBody className="space-y-4">
          {blocked ? (
            <InlineAlert tone="warning" live="off">
              <p>{blocked}</p>
              <a
                href={`${ROUTES.PROFILE}?tab=security`}
                className="-my-1.5 inline-block rounded-sm py-1.5 font-medium underline underline-offset-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Profile &gt; Security
              </a>
            </InlineAlert>
          ) : (
            <>
              {hasPassword ? (
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-password`}>Your password</Label>
                  <Input
                    id={`${idPrefix}-password`}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    onKeyDown={onEnter}
                  />
                </div>
              ) : (
                <EmailStepUp
                  idPrefix={`${idPrefix}-step-up`}
                  emailConfigured={emailConfigured}
                  onReady={() => setFirstStepUpDone(true)}
                />
              )}

              {factor === "totp" ? (
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-totp`}>
                    Code from your authenticator app
                  </Label>
                  <Input
                    id={`${idPrefix}-totp`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    onChange={(e) =>
                      setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    onKeyDown={onEnter}
                    className="h-10 w-[180px] text-center text-lg tracking-[0.3em] font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Backup codes are not accepted here.
                  </p>
                </div>
              ) : (
                <EmailStepUp
                  key={emailFactorRound}
                  idPrefix={`${idPrefix}-factor`}
                  mode="second-factor"
                  emailConfigured={emailConfigured}
                  onReady={() => setEmailFactorDone(true)}
                />
              )}
            </>
          )}
          {error && (
            <div id={errorId}>
              <InlineAlert tone="error">{error}</InlineAlert>
            </div>
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
          {!blocked && (
            <Button
              variant={variant === "destructive" ? "destructive" : "default"}
              disabled={!canConfirm}
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
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
