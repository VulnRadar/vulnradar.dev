"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

export function TeamJoinInvalid() {
  return (
    <AuthOutcome
      tone="negative"
      title="That invite link doesn't work"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href="/teams">Go to Teams</Link>
        </Button>
      }
      footnote="Ask whoever invited you to send a fresh link from the team's invite page."
    >
      <p>This link is missing its token or has expired.</p>
    </AuthOutcome>
  );
}
