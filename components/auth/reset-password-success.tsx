"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

export function ResetPasswordSuccess() {
  return (
    <AuthOutcome
      tone="positive"
      title="Password changed"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href="/login">Sign in with the new password</Link>
        </Button>
      }
    >
      <p>
        Every session was signed out, so anything still logged in as you on
        another device needs the new password.
      </p>
      <p>
        Trusted devices were cleared too. If two-factor auth is on, the next
        sign-in asks for a code even on a machine you had marked as trusted.
      </p>
    </AuthOutcome>
  );
}
