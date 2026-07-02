"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";

export function TeamJoinInvalid() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Invalid invite link.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
          This link is missing a valid token or has expired. Ask someone from
          the team to send you a new one.
        </p>
      </div>
      <Button asChild variant="outline" className="w-full border-border/50">
        <Link href="/teams">Go to Teams</Link>
      </Button>
    </div>
  );
}
