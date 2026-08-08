"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

export function ResetPasswordInvalid() {
  return (
    <AuthOutcome
      tone="negative"
      title="That reset link is missing its token"
      actions={
        <>
          <Button
            asChild
            size="lg"
            className={cn("h-11 w-full", authFocusRing)}
          >
            <Link href="/forgot-password">Request a new link</Link>
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
      footnote="Reset links are long and some mail clients wrap them across lines. Copying the whole line, or opening the link straight from the email, usually fixes it."
    >
      <p>
        Nothing here identifies the account, so there is no password to change.
        Request a new link and open it from the email.
      </p>
    </AuthOutcome>
  );
}
