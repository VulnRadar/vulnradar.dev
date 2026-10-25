"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { apiPost } from "@/lib/api/client";
import { API, ROUTES } from "@/lib/config/client-constants";
import { useVisibleInterval } from "@/lib/hooks/use-visible-interval";

interface AdminHeartbeatOptions {
  interval?: number; // ms between heartbeats, default 60s
  enabled?: boolean; // only fires when true (i.e. user is staff)
}

/**
 * Global staff heartbeat hook.
 * Tracks staff presence across the entire app — not just the admin panel.
 * The "section" is derived from the current pathname automatically.
 *
 * Beats only while the tab is visible. It used to run a bare setInterval, and
 * the hook is mounted from the root layout for every staff tab, so a tab left
 * open in the background kept upserting staff_activity once a minute and kept
 * reporting that staff member as active in the Active Staff view for as long as
 * the browser stayed open. A hidden tab stops beating, and one beat is sent the
 * moment it is shown again (see useVisibleInterval).
 */
export function useAdminHeartbeat({
  interval = 60000,
  enabled = true,
}: AdminHeartbeatOptions = {}) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  // Always keep the ref fresh so the interval closure picks up route changes
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const sendHeartbeat = useCallback(async () => {
    // Derive a human-readable section label from the pathname
    const path = pathnameRef.current || "/";
    let section = "app";
    if (path.startsWith(ROUTES.ADMIN)) section = "admin";
    else if (path.startsWith(ROUTES.DASHBOARD)) section = "dashboard";
    else if (path.startsWith(ROUTES.PROFILE)) section = "profile";
    else if (path.startsWith(ROUTES.TEAMS)) section = "teams";
    else if (path.startsWith("/scan")) section = "scan";
    else if (path.startsWith(ROUTES.HISTORY)) section = "history";

    try {
      await apiPost(`${API.ADMIN}/activity`, { section });
    } catch {
      // Silently fail — never disrupt the UI
    }
  }, []);

  // Fire immediately on mount / when enabled flips to true, unless the tab is
  // hidden: a tab opened in the background is not someone being here, and
  // useVisibleInterval sends the first beat when it is brought forward.
  useEffect(() => {
    if (!enabled) return;
    if (document.visibilityState === "hidden") return;
    void sendHeartbeat();
  }, [enabled, sendHeartbeat]);

  useVisibleInterval(sendHeartbeat, enabled ? interval : null);
}
