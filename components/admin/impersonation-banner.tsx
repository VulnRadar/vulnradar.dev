"use client";

import { useEffect, useRef, useState } from "react";
import { UserCog, Loader2, AlertTriangle } from "lucide-react";
import {
  useAuth,
  refreshAuthCache,
} from "@/components/providers/auth-provider";
import { API, ROUTES } from "@/lib/config/client-constants";

/**
 * Fixed banner shown app-wide while the current session is an active
 * admin-impersonation session (see lib/auth/impersonation.ts). Mounted
 * unconditionally inside AuthProvider -- renders nothing when not
 * impersonating.
 *
 * Publishes its own height as --vr-imp-banner-h, the same pattern
 * components/shared/site-notifications.tsx uses for --vr-banner-h: the
 * scanner header (components/scanner/header.tsx) is `position: fixed`
 * and reads both variables to offset below whichever banners are
 * actually showing. Without this, this banner (fixed, top: 0) painted
 * on top of the header (also anchored at top: 0, since it only knew
 * about --vr-banner-h), hiding the header and every nav link behind it
 * for the whole impersonation session. Kept as its own variable rather
 * than reusing --vr-banner-h so the two banner systems don't stomp each
 * other's value if both happen to be active at once -- site-notifications
 * offsets its own banner stack below this one using the same variable.
 */
export function ImpersonationBanner() {
  const { me } = useAuth();
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const isImpersonating = !!me?.isImpersonating;

  useEffect(() => {
    const root = document.documentElement;
    const el = bannerRef.current;
    if (!isImpersonating || !el) {
      root.style.setProperty("--vr-imp-banner-h", "0px");
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty(
        "--vr-imp-banner-h",
        `${entry.contentRect.height}px`,
      );
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty("--vr-imp-banner-h", "0px");
    };
  }, [isImpersonating]);

  if (!isImpersonating) return null;

  async function handleStop() {
    setStopping(true);
    setStopError(false);
    try {
      const res = await fetch(API.AUTH.IMPERSONATION_STOP, {
        method: "POST",
      });
      if (!res.ok) {
        setStopError(true);
        setStopping(false);
        return;
      }
    } catch {
      setStopError(true);
      setStopping(false);
      return;
    }
    // Full reload, not a client-side refreshAuthCache-only update: the
    // session identity itself just changed (back to the admin account),
    // so every already-fetched piece of page state for the impersonated
    // user needs to go, not just the cached /api/v3/auth/me response.
    refreshAuthCache();
    window.location.href = ROUTES.ADMIN;
  }

  return (
    <div
      ref={bannerRef}
      role="alert"
      /* flex-wrap + min-w-0 + truncate: at 375px the unwrapped row measured
         wider than the viewport, and justify-center split the overflow both
         ways, so the page scrolled horizontally on every route while
         impersonating and the Stop button sat partly off the right edge. */
      className="fixed top-0 left-0 right-0 z-60 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        Viewing as{" "}
        <span className="font-semibold max-w-[45vw] inline-block align-bottom truncate">
          {me.email}
        </span>
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-amber-950/10 px-2.5 py-1 font-semibold hover:bg-amber-950/20 disabled:opacity-60"
      >
        {stopping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Stop impersonating
      </button>
      {stopError && (
        <span className="inline-flex items-center gap-1 text-amber-950/80 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Couldn&apos;t stop, try again
        </span>
      )}
    </div>
  );
}
