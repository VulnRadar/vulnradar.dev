"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Profile] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">
            Couldn't load your profile
          </h2>
          <p className="text-sm text-muted-foreground">
            Something went wrong while loading your profile. This has been
            logged.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground/70 mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>
        <Button onClick={reset} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
