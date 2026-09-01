"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw, Copy, Check } from "lucide-react";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { hasCachedSignIn } from "@/components/shared/auth-cache-client";
import { Button } from "@/components/ui/button";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";
import { focus } from "@/lib/ui/animations";
import { copyToClipboard } from "@/lib/ui/clipboard";

/**
 * One of three pages that share a single composition: wordmark lockup, a ruled
 * band holding a monospace status numeral, one honest sentence, a two-up
 * action row and a row of footer links. app/not-found.tsx is the 404 and
 * app/global-error.tsx is the literal-hex copy for the boundary that replaces
 * <html> itself. Change the composition here and change it in both siblings.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Resolved after mount so the server-rendered HTML and the first client
  // render agree (localStorage does not exist on the server).
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage, which is external to React and unavailable during render
    setIsLoggedIn(hasCachedSignIn());
  }, []);

  useEffect(() => {
    console.error(`[${APP_NAME}] Unhandled error:`, error);
  }, [error]);

  async function copyErrorId() {
    if (error.digest && (await copyToClipboard(error.digest))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <div className="flex items-center gap-2.5">
          <ThemedLogo
            width={28}
            height={28}
            className="h-7 w-7"
            alt={`${APP_NAME} logo`}
          />
          <span className="text-xl font-mono font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
        </div>

        <div className="flex flex-col items-center gap-3 text-center border-y border-border/50 py-8 w-full">
          <AlertTriangle
            className="h-8 w-8 text-destructive mb-1"
            aria-hidden="true"
          />
          <p className="font-mono text-6xl font-semibold text-foreground tabular-nums">
            500
          </p>
          <h1 className="text-lg font-semibold text-foreground text-balance">
            Something broke on our end
          </h1>
          {/* Only a server-side error carries a digest, and only a server-side
              error actually reaches our logs: the boundary's own report is a
              console.error in the visitor's browser and goes nowhere. Claiming
              "this has been logged" for a client-only render crash told the
              user someone was already looking, when nobody was. */}
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm text-pretty">
            {error.digest
              ? "This has been logged. Try again, or come back once we have looked at it."
              : "Try again. If it keeps happening, tell us what you were doing and we will chase it down."}
          </p>

          {error.digest && (
            <div className="w-full rounded-lg border border-border bg-card overflow-hidden mt-2 text-left">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                <span className="text-xs font-mono text-muted-foreground">
                  error.digest
                </span>
                <button
                  onClick={copyErrorId}
                  className={`flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-sm ${focus.ring}`}
                >
                  {copied ? (
                    <Check
                      className="h-3 w-3 text-[hsl(var(--success))]"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">
                    {copied ? "Copied" : "Copy"}
                  </span>
                </button>
              </div>
              <p className="px-3 py-2.5 text-xs font-mono text-foreground break-all">
                {error.digest}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <Button onClick={reset} variant="default" className="flex-1 gap-2">
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            asChild
            variant="outline"
            className="flex-1 gap-2 bg-transparent"
          >
            {/* Conditional for the same reason as app/not-found.tsx: a
                logged-out visitor sent to the dashboard just bounces to the
                login screen. */}
            <Link href={isLoggedIn ? ROUTES.DASHBOARD : ROUTES.HOME}>
              <Home className="h-4 w-4" aria-hidden="true" />
              {isLoggedIn ? "Go to Dashboard" : "Go to the home page"}
            </Link>
          </Button>
        </div>

        <div className="flex gap-4 text-xs">
          <Link
            href={ROUTES.CONTACT}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${focus.ring}`}
          >
            Contact
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Link
            href={ROUTES.DOCS}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${focus.ring}`}
          >
            Documentation
          </Link>
        </div>
      </div>
    </div>
  );
}
