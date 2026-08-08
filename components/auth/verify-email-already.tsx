"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

interface VerifyEmailAlreadyProps {
  message: string;
}

export function VerifyEmailAlready({ message }: VerifyEmailAlreadyProps) {
  return (
    <AuthOutcome
      tone="positive"
      title="Already verified"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href="/login">Sign in</Link>
        </Button>
      }
      footnote="Nothing more to do here. Verification links stop working once they have been used, which is why this one looks inert."
    >
      <p>{message}</p>
    </AuthOutcome>
  );
}
