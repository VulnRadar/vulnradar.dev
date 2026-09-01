"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  API,
  EMAIL_VERIFICATION_TOKEN_LIFETIME,
} from "@/lib/config/client-constants";
import { cn } from "@/lib/ui/utils";
import {
  AuthAlert,
  AuthOutcome,
  authFocusRing,
} from "@/components/auth/auth-shell";

const VERIFY_HOURS = Math.round(EMAIL_VERIFICATION_TOKEN_LIFETIME / 3600);

interface SignupSuccessProps {
  email: string;
}

export function SignupSuccess({ email }: SignupSuccessProps) {
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState("");
  const [resendOk, setResendOk] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setResendMessage("");
    try {
      const res = await fetch(API.AUTH.RESEND_VERIFICATION, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setResendOk(true);
        setResendMessage("Sent again. The older link no longer works.");
        setResendCooldown(60);
      } else {
        setResendOk(false);
        setResendMessage(
          data.error || "That email could not be sent. Try again in a minute.",
        );
      }
    } catch {
      setResendOk(false);
      setResendMessage(
        "Could not reach the server. Check your connection, then retry.",
      );
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthOutcome
      tone="positive"
      title="Check your email"
      actions={
        <>
          {resendMessage && (
            <AuthAlert tone={resendOk ? "info" : "error"}>
              {resendMessage}
            </AuthAlert>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={handleResend}
            disabled={resending || resendCooldown > 0}
            className={cn("h-11 w-full border-border/60", authFocusRing)}
          >
            {resending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Sending
              </>
            ) : resendCooldown > 0 ? (
              `Send it again in ${resendCooldown}s`
            ) : (
              "Send it again"
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
        </>
      }
      footnote={`Nothing after a few minutes? Check spam, and confirm ${email} is spelled right. You can start over from the sign-up form.`}
    >
      {/* Deliberately non-committal about what is in the email, and it must
          stay that way. POST /api/v3/auth/signup returns a byte-identical 200
          whether or not the address already has an account: a registered one
          gets a "someone tried to sign up as you, here is how to sign in"
          notice instead of a verification link, and the disambiguation happens
          in the inbox, which only the address owner can read. This screen used
          to say "we sent a verification link" and "the account is ready",
          which is false for that second case, and any copy here that hints at
          which of the two happened rebuilds in the UI the account-enumeration
          oracle the 409 response was removed to close. */}
      <p>
        We sent an email to{" "}
        <span className="font-medium text-foreground break-all">{email}</span>.
        Open it and follow the link inside.
      </p>
      <p>Verification links work once and expire in {VERIFY_HOURS} hours.</p>
    </AuthOutcome>
  );
}
