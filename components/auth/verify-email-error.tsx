"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

interface VerifyEmailErrorProps {
  message: string;
}

export function VerifyEmailError({ message }: VerifyEmailErrorProps) {
  return (
    <AuthOutcome
      tone="negative"
      title="That link did not verify anything"
      actions={
        <>
          <Button
            asChild
            size="lg"
            className={cn("h-11 w-full", authFocusRing)}
          >
            <Link href="/login">Sign in and send a new link</Link>
          </Button>
          <Button
            asChild
            variant="ghost"
            size="lg"
            className={cn("h-11 w-full", authFocusRing)}
          >
            <Link href="/signup">Create an account instead</Link>
          </Button>
        </>
      }
      footnote="Signing in with an unverified account offers to send the link again, so that is the shortest way back."
    >
      <p>{message}</p>
    </AuthOutcome>
  );
}
