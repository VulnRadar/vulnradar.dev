"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RouteErrorProps {
  /** The route's own name, used in the console tag: "[Profile] ...". */
  area: string;
  /** Headline. Say what failed, in the reader's terms, not the stack's. */
  title: string;
  /** One sentence under it. Say what it means and what happens next. */
  description: string;
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * The body every route-level error.tsx renders.
 *
 * These boundaries were eight near-identical files that had already drifted:
 * some carried role="alert" and aria-hidden on the icon, some did not, so
 * whether a screen reader was told the page had failed depended on which
 * route you were on. Routes that had no boundary at all fell through to the
 * root one, which replaces the entire document including the nav, turning a
 * failure in one panel into "the whole site broke".
 *
 * `reset` re-renders the segment, which is the right first move for the
 * transient causes (a dropped request, a stale chunk after a deploy) that
 * account for most of what lands here.
 */
export function RouteError({
  area,
  title,
  description,
  error,
  reset,
}: RouteErrorProps) {
  useEffect(() => {
    console.error(`[${area}] Unhandled error:`, error);
  }, [area, error]);

  return (
    <div
      className="min-h-[60vh] flex flex-col items-center justify-center px-4"
      role="alert"
    >
      <div className="max-w-md w-full flex flex-col items-center text-center gap-4">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20">
          <AlertTriangle
            className="h-7 w-7 text-destructive"
            aria-hidden="true"
          />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
          {/* The digest is the only handle support has on a specific
              failure, so it is shown rather than kept in the console. */}
          {error.digest && (
            <p className="text-[11px] font-mono text-muted-foreground/70 mt-1">
              ref: {error.digest}
            </p>
          )}
        </div>
        <Button onClick={reset} className="gap-2">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
