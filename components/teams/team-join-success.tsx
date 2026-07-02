"use client";

import { Loader2 } from "lucide-react";

export function TeamJoinSuccess() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-emerald-500">
          Joined.
        </h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          You have successfully joined the team.
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Redirecting to teams...</span>
      </div>
    </div>
  );
}
