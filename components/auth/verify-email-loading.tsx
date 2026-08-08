"use client";

import { Loader2 } from "lucide-react";

export function VerifyEmailLoading() {
  return (
    <div className="border-l-2 border-border pl-4" aria-busy="true">
      <div className="flex items-center gap-2.5">
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
          aria-hidden="true"
        />
        <h1 className="text-2xl font-semibold tracking-tight">Verifying</h1>
      </div>
      <p
        className="text-sm text-muted-foreground leading-relaxed mt-2"
        role="status"
      >
        Checking the token in your link. This takes a second.
      </p>
    </div>
  );
}
