"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/constants";

const STORAGE_KEY = "vr-cookie-notice-dismissed";

/**
 * Dismissible cookie notice, shown once until dismissed (persisted in
 * localStorage). VulnRadar sets only strictly-necessary cookies (session, CSRF,
 * theme, consent), so this is an informational bottom bar, not a
 * blocking accept/reject consent gate. SSR-safe: renders nothing on the server
 * and on the first client render (so hydration matches), then appears on mount
 * only if it hasn't been dismissed.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Storage blocked (private mode, etc.): show it; dismiss just won't persist.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot post-mount reveal based on localStorage; keeps SSR/first-render output empty
    if (!dismissed) setVisible(true);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore: nothing to persist to */
    }
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
        <p className="flex-1 text-sm text-muted-foreground">
          We use only essential cookies to keep you signed in and the app
          working, no advertising or third-party tracking. See our{" "}
          <a
            href={ROUTES.LEGAL_PRIVACY}
            className="text-primary hover:underline"
          >
            Privacy Policy
          </a>
          .
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" onClick={dismiss} className="h-8">
            Got it
          </Button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss cookie notice"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
