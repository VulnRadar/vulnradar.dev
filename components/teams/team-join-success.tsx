"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";
import { AuthOutcome, authFocusRing } from "@/components/auth/auth-shell";

export function TeamJoinSuccess() {
  return (
    <AuthOutcome
      tone="positive"
      title="Joined"
      actions={
        <Button asChild size="lg" className={cn("h-11 w-full", authFocusRing)}>
          <Link href="/teams">Go to Teams now</Link>
        </Button>
      }
    >
      <p>You now have access to this team&apos;s shared reports.</p>
      <p className="flex items-center gap-2 text-xs text-muted-foreground/70">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Redirecting automatically...
      </p>
    </AuthOutcome>
  );
}
