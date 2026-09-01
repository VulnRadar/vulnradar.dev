"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PASSWORD_RESET_TOKEN_LIFETIME } from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

const RESET_MINUTES = Math.round(PASSWORD_RESET_TOKEN_LIFETIME / 60);
const RESET_WINDOW =
  RESET_MINUTES >= 60
    ? `${Math.round(RESET_MINUTES / 60)} hour${RESET_MINUTES >= 120 ? "s" : ""}`
    : `${RESET_MINUTES} minutes`;

export function ForgotPasswordSuccess({ email }: { email?: string }) {
  return (
    <AuthOutcome
      tone="positive"
      title="Reset link sent"
      actions={
        <>
          <Button
            asChild
            variant="outline"
            size="lg"
            className={cn("h-11 w-full border-border/60", authFocusRing)}
          >
            <Link href="/login">Back to sign in</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="lg"
            className={cn("h-11 w-full", authFocusRing)}
          >
            <Link href="/forgot-password">Try a different email</Link>
          </Button>
        </>
      }
      footnote="Nothing after a few minutes? Check spam. If the address has no account, no email is sent, which is deliberate."
    >
      <p>
        If an account exists for{" "}
        {email ? (
          <span className="font-medium text-foreground break-all">{email}</span>
        ) : (
          "that address"
        )}
        , a reset link is on its way.
      </p>
      <p>The link works once and expires in {RESET_WINDOW}.</p>
    </AuthOutcome>
  );
}
