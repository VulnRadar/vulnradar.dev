"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  API,
  EMAIL_VERIFICATION_TOKEN_LIFETIME,
} from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import {
  AuthAlert,
  AuthOutcome,
  AuthOutcomeHeader,
  authFieldClass,
  authFocusRing,
} from "@/components/auth/auth-shell";

const VERIFY_HOURS = Math.round(EMAIL_VERIFICATION_TOKEN_LIFETIME / 3600);

interface VerifyEmailExpiredProps {
  message: string;
}

export function VerifyEmailExpired({ message }: VerifyEmailExpiredProps) {
  const [resendEmail, setResendEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleResend(e: React.FormEvent) {
    e.preventDefault();
    if (!resendEmail) return;
    setResending(true);
    setResendSuccess(false);
    setError("");

    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resendEmail }),
      });

      const data = await res.json();
      if (res.ok) {
        setResendSuccess(true);
      } else {
        setError(
          data.error ||
            "That email could not be sent. Wait a minute and try again.",
        );
      }
    } catch {
      setError(
        "Could not reach the server. Check your connection, then retry.",
      );
    } finally {
      setResending(false);
    }
  }

  if (resendSuccess) {
    return (
      <AuthOutcome
        tone="positive"
        title="New link sent"
        actions={
          <Button
            asChild
            variant="outline"
            size="lg"
            className={cn("h-11 w-full border-border/60", authFocusRing)}
          >
            <Link href="/login">Back to sign in</Link>
          </Button>
        }
        footnote="Check spam if it has not landed in a couple of minutes."
      >
        <p>
          If{" "}
          <span className="font-medium text-foreground break-all">
            {resendEmail}
          </span>{" "}
          has an unverified account, a fresh link is on its way. It expires in{" "}
          {VERIFY_HOURS} hours.
        </p>
      </AuthOutcome>
    );
  }

  return (
    <div>
      {/* Was a hand-rolled copy of the outcome keyline with an off-tier
          `text-2xl` h1. Reuses the shell's header now, with no heading ref so
          focus stays on the autofocused email field below. */}
      <AuthOutcomeHeader
        tone="negative"
        title="That link expired"
        className="mb-7"
      >
        <p>{message} Enter your email below and we will send a new one.</p>
      </AuthOutcomeHeader>

      <form onSubmit={handleResend} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resend-email">Email you signed up with</Label>
          <Input
            id="resend-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={resendEmail}
            onChange={(e) => setResendEmail(e.target.value)}
            placeholder="name@example.com"
            required
            autoFocus
            className={authFieldClass}
          />
        </div>

        {error && <AuthAlert>{error}</AuthAlert>}

        <Button
          type="submit"
          size="lg"
          disabled={resending || !resendEmail}
          className={cn("h-11 w-full", authFocusRing)}
        >
          {resending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Sending
            </>
          ) : (
            "Send a new link"
          )}
        </Button>

        <Button
          asChild
          variant="ghost"
          size="lg"
          className={cn("h-11 w-full", authFocusRing)}
        >
          <Link href="/login">Back to sign in</Link>
        </Button>
      </form>
    </div>
  );
}
