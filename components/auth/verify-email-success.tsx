"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";
import { readPostVerifyRedirect } from "@/components/auth/redirect-target";
import { ROUTES } from "@/lib/config/client-constants";

interface VerifyEmailSuccessProps {
  message: string;
}

export function VerifyEmailSuccess({ message }: VerifyEmailSuccessProps) {
  // Lazy so the cookie is read once. This screen only mounts after the client
  // has finished verifying, so there is no server render to disagree with.
  const [target] = useState(() => readPostVerifyRedirect(ROUTES.DASHBOARD));
  return (
    <AuthOutcome
      tone="positive"
      title="Email verified"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href={target}>
            {target === ROUTES.DASHBOARD
              ? "Go to the dashboard"
              : "Continue where you left off"}
          </Link>
        </Button>
      }
      footnote="Taking you there now."
    >
      <p>{message}</p>
    </AuthOutcome>
  );
}
