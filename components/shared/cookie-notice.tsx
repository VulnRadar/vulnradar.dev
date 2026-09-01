"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/config/client-constants";

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
  const barRef = useRef<HTMLDivElement>(null);

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

  // Publish the bar's real height the way site-notifications.tsx publishes
  // --vr-banner-h. This bar is mounted last in the root layout, so at an equal
  // z-index it painted over every fixed bottom control in the app: the "Save
  // Changes" bars on /profile and two admin editors, and the docs "Contents"
  // button. At 375px it is roughly 125px tall (three lines of copy plus a
  // button row), which covered those controls completely. Anything fixed to
  // the bottom offsets by --vr-cookie-h instead of guessing a constant.
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty("--vr-cookie-h", "0px");
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty("--vr-cookie-h", `${entry.contentRect.height}px`);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--vr-cookie-h", "0px");
    };
  }, [visible]);

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
      ref={barRef}
      role="region"
      aria-label="Cookie notice"
      // z-60, above the z-50 floating save bars, so the two never tie on
      // paint order; they offset above it via --vr-cookie-h.
      className="fixed inset-x-0 bottom-0 z-60 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
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
