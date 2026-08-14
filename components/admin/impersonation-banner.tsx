"use client";

import { useState } from "react";
import { UserCog, Loader2 } from "lucide-react";
import {
  useAuth,
  refreshAuthCache,
} from "@/components/providers/auth-provider";
import { API } from "@/lib/config/constants";
import { ROUTES } from "@/lib/config/client-constants";

/**
 * Fixed banner shown app-wide while the current session is an active
 * admin-impersonation session (see lib/auth/impersonation.ts). Mounted
 * unconditionally inside AuthProvider -- renders nothing when not
 * impersonating.
 */
export function ImpersonationBanner() {
  const { me } = useAuth();
  const [stopping, setStopping] = useState(false);

  if (!me?.isImpersonating) return null;

  async function handleStop() {
    setStopping(true);
    try {
      await fetch(API.AUTH.IMPERSONATION_STOP, { method: "POST" });
    } finally {
      // Full reload, not a client-side refreshAuthCache-only update: the
      // session identity itself just changed (back to the admin account),
      // so every already-fetched piece of page state for the impersonated
      // user needs to go, not just the cached /api/v3/auth/me response.
      refreshAuthCache();
      window.location.href = ROUTES.ADMIN;
    }
  }

  return (
    <div
      role="alert"
      className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <UserCog className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        Viewing as <span className="font-semibold">{me.email}</span>
      </span>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        className="ml-2 inline-flex items-center gap-1.5 rounded-md bg-amber-950/10 px-2.5 py-1 font-semibold hover:bg-amber-950/20 disabled:opacity-60"
      >
        {stopping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Stop impersonating
      </button>
    </div>
  );
}
