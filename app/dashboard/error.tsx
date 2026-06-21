"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config/constants";

/**
 * Per-route error boundary for /dashboard.
 *
an unhandled error on the dashboard used to bubble
 * up to the root `app/error.tsx` and replace the entire layout, which
 * is jarring. This boundary keeps the surrounding chrome (header,
 * sidebar) intact and shows an inline error inside the page body.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Dashboard] Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">
            {`Couldn't load ${APP_NAME} dashboard`}
          </h2>
          <p className="text-sm text-muted-foreground">
            An error occurred while loading your dashboard. This has been
            logged.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground/70 mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>
        <div className="flex gap-2 w-full">
          <Button onClick={reset} className="flex-1 gap-2">
            <RotateCcw className="h-4 w-4" />
            Try Again
          </Button>
          <Button asChild variant="outline" className="flex-1 bg-transparent">
            <Link href="/" className="flex items-center justify-center gap-2">
              <Home className="h-4 w-4" />
              Home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
