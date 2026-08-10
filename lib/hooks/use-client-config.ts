"use client";

import { useEffect, useState } from "react";
import {
  VERSION_COOKIE_MAX_AGE,
  NOTIFICATION_POLL_INTERVAL_MS as DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_DEFAULT_DISMISS_MAX_AGE,
  BROWSERBASE_LOGS_POLL_INTERVAL_MS as DEFAULT_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  SCANNING,
  FEATURES,
} from "@/lib/config/constants";

export interface ClientConfig {
  versionCookieMaxAgeSeconds: number;
  notificationPollIntervalMs: number;
  // Seconds, not ms -- matches setCookie()'s maxAgeSeconds parameter and
  // the compiled NOTIFICATION_DEFAULT_DISMISS_MAX_AGE constant it replaces.
  notificationDefaultDismissMaxAgeSeconds: number;
  browserbaseLogsPollIntervalMs: number;
  scanStatusPollIntervalMs: number;
  featurePdfReports: boolean;
}

// Compiled-constant fallback: same values a client component used before
// this hook existed, so a slow/failed fetch degrades to today's behavior
// rather than breaking anything.
const DEFAULT_CONFIG: ClientConfig = {
  versionCookieMaxAgeSeconds: VERSION_COOKIE_MAX_AGE,
  notificationPollIntervalMs: DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  notificationDefaultDismissMaxAgeSeconds: NOTIFICATION_DEFAULT_DISMISS_MAX_AGE,
  browserbaseLogsPollIntervalMs: DEFAULT_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  scanStatusPollIntervalMs: SCANNING.STATUS_POLL_INTERVAL_MS,
  featurePdfReports: FEATURES.PDF_REPORTS,
};

/**
 * A handful of admin-editable settings (poll intervals, dismiss windows, the
 * PDF-report feature flag) only matter inside client components, which
 * can't call the server-only getSetting()/getSettings() resolver directly.
 * This hook fetches the live values once from GET /api/v3/config/client and
 * falls back to the compiled defaults until it resolves (or if it fails),
 * so an admin edit reaches the browser without every poller needing its own
 * fetch/cache logic.
 */
export function useClientConfig(): ClientConfig {
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v3/config/client")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setConfig({
          versionCookieMaxAgeSeconds:
            Number(data.versionCookieMaxAgeDays) * 24 * 60 * 60,
          notificationPollIntervalMs: Number(data.notificationPollIntervalMs),
          notificationDefaultDismissMaxAgeSeconds:
            Number(data.notificationDefaultDismissDays) * 24 * 60 * 60,
          browserbaseLogsPollIntervalMs: Number(
            data.browserbaseLogsPollIntervalMs,
          ),
          scanStatusPollIntervalMs: Number(data.scanStatusPollIntervalMs),
          featurePdfReports: Boolean(data.featurePdfReports),
        });
      })
      .catch(() => {
        /* keep the compiled defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}
