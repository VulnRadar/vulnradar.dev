"use client";

import { Loader2 } from "lucide-react";
import { AUTH_HEADING_CLASS } from "./auth-shell";

/**
 * The heading here is the SAME class every other state of this flow uses.
 *
 * It was a flat `text-2xl`, which is neither H1 tier, while every state this
 * resolves into (verified, expired, already-verified, failed) renders through
 * AuthOutcome at Tier B. Below sm that meant 24px while the words said
 * "Verifying" and 20px a second later when the answer arrived, on the same
 * screen, with nothing else changing. auth-shell.tsx had already been fixed
 * and documented; this copy sitting next to it had not.
 */
export function VerifyEmailLoading() {
  return (
    <div className="border-l-2 border-border pl-4" aria-busy="true">
      <div className="flex items-center gap-2.5">
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
          aria-hidden="true"
        />
        <h1 className={AUTH_HEADING_CLASS}>Verifying</h1>
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
