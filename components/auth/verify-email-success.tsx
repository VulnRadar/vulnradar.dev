"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";
import { ROUTES } from "@/lib/config/client-constants";

interface VerifyEmailSuccessProps {
  message: string;
}

export function VerifyEmailSuccess({ message }: VerifyEmailSuccessProps) {
  return (
    <AuthOutcome
      tone="positive"
      title="Email verified"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href={ROUTES.DASHBOARD}>Go to the dashboard</Link>
        </Button>
      }
      footnote="Taking you there now."
    >
      <p>{message}</p>
    </AuthOutcome>
  );
}
