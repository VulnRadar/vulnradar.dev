"use client";

import { Loader2 } from "lucide-react";

export function VerifyEmailLoading() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
        <h1 className="text-2xl font-semibold tracking-tight">Verifying</h1>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        Checking your verification token...
      </p>
    </div>
  );
}
