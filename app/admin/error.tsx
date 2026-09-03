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
    console.error("[Admin] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle
            className="h-7 w-7 text-destructive"
            aria-hidden="true"
          />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Admin panel error
          </h2>
          {/* Says what to do next. It used to say only that the error had
              been logged, which tells an operator nothing they can act on:
              the reference below is the string that finds it in Error Logs. */}
          <p className="text-sm text-muted-foreground">
            Something in this panel threw. It has been captured in Error Logs,
            so retry first, and if it happens again search that tab for the
            reference below.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset} className="h-9 gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="outline" className="h-9">
            <a href="/admin?tab=error-logs">Open error logs</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
