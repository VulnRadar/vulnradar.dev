"use client";

import { useEffect } from "react";
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppPageShell } from "@/components/shared/app-page-shell";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { ROUTES } from "@/lib/config/client-constants";

interface RouteErrorProps {
  /** The route's own name, used in the console tag: "[Profile] ...". */
  area: string;
  /** Headline. Say what failed, in the reader's terms, not the stack's. */
  title: string;
  /** One sentence under it. Say what it means and what happens next. */
  description: string;
  error: Error & { digest?: string };
  reset: () => void;
  /** Replaces the default "Back to scanner" beside "Try again", for a route
   *  that has somewhere more specific to send the reader. */
  action?: React.ReactNode;
  /** Which chrome the failed page normally wears: the signed-in app header
   *  (default), or the public nav for a route a logged-out visitor can reach
   *  (/contact, /checkout, /public-scans). */
  chrome?: "app" | "public";
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
 * It then did the same thing one level down. Header, <main> and Footer are
 * rendered by each page (AppPageShell), not by the route layouts, so a
 * segment that threw lost all three along with the page: no navigation but the
 * browser's back button, no landmark for the skip link to land on, and no H1.
 * The boundary now wears the shell itself, so a failed panel still has a way
 * out and the page has a heading and a main.
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
  action,
  chrome = "app",
}: RouteErrorProps) {
  useEffect(() => {
    console.error(`[${area}] Unhandled error:`, error);
  }, [area, error]);

  const Shell = chrome === "public" ? PublicPageShell : AppPageShell;

  return (
    <Shell>
      <div
        className="min-h-[60vh] flex flex-col items-center justify-center"
        role="alert"
      >
        <div className="max-w-md w-full flex flex-col items-center text-center gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertTriangle
              className="h-7 w-7 text-destructive"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col gap-1">
            {/* Tier C: a failure page is not one someone chose to visit. */}
            <h1 className="text-lg font-semibold text-foreground">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
            {/* The digest is the only handle support has on a specific
                failure, so it is shown rather than kept in the console. */}
            {error.digest && (
              <p className="text-[11px] font-mono text-muted-foreground/70 mt-1">
                ref: {error.digest}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            {/* A plain anchor, not next/link: this is the page shown because
                something in the app just threw, often a chunk that went stale
                under a deploy, and a full navigation is the one that does not
                depend on the client router still being sound. */}
            {action ?? (
              <Button asChild variant="outline">
                <a
                  href={chrome === "public" ? ROUTES.LANDING : ROUTES.DASHBOARD}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  {chrome === "public" ? "Back to home" : "Back to scanner"}
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
