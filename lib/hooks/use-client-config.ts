"use client";

import { useEffect, useMemo, useState } from "react";
import {
  VERSION_COOKIE_MAX_AGE,
  NOTIFICATION_POLL_INTERVAL_MS as DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  NOTIFICATION_DEFAULT_DISMISS_MAX_AGE,
  BROWSERBASE_LOGS_POLL_INTERVAL_MS as DEFAULT_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  SCANNING,
  FEATURES,
} from "@/lib/config/client-constants";

export interface ClientConfig {
  versionCookieMaxAgeSeconds: number;
  notificationPollIntervalMs: number;
  // Seconds, not ms -- matches setCookie()'s maxAgeSeconds parameter and
  // the compiled NOTIFICATION_DEFAULT_DISMISS_MAX_AGE constant it replaces.
  notificationDefaultDismissMaxAgeSeconds: number;
  browserbaseLogsPollIntervalMs: number;
  scanStatusPollIntervalMs: number;
  // All nine feature flags. Only featurePdfReports used to cross to the
  // browser, so turning any other feature off left its UI fully present and
  // the user found out from a 403 on submit.
  featurePdfReports: boolean;
  featureDemoMode: boolean;
  featureTeams: boolean;
  featureApiKeys: boolean;
  featureWebhooks: boolean;
  featureScheduledScans: boolean;
  featureBulkScans: boolean;
  featureEmailNotifications: boolean;
  featureDomainVerification: boolean;
}

// Compiled-constant fallback: same values a client component used before
// this hook existed, so a slow/failed fetch degrades to today's behavior
// rather than breaking anything.
export const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  versionCookieMaxAgeSeconds: VERSION_COOKIE_MAX_AGE,
  notificationPollIntervalMs: DEFAULT_NOTIFICATION_POLL_INTERVAL_MS,
  notificationDefaultDismissMaxAgeSeconds: NOTIFICATION_DEFAULT_DISMISS_MAX_AGE,
  browserbaseLogsPollIntervalMs: DEFAULT_BROWSERBASE_LOGS_POLL_INTERVAL_MS,
  scanStatusPollIntervalMs: SCANNING.STATUS_POLL_INTERVAL_MS,
  featurePdfReports: FEATURES.PDF_REPORTS,
  featureDemoMode: FEATURES.DEMO_MODE,
  featureTeams: FEATURES.TEAMS,
  featureApiKeys: FEATURES.API_KEYS,
  featureWebhooks: FEATURES.WEBHOOKS,
  featureScheduledScans: FEATURES.SCHEDULED_SCANS,
  featureBulkScans: FEATURES.BULK_SCANS,
  featureEmailNotifications: FEATURES.EMAIL_NOTIFICATIONS,
  // FEATURES (lib/config/constants.ts) has no DOMAIN_VERIFICATION entry, so
  // the pre-fetch fallback is the registry default: on.
  featureDomainVerification: true,
};

/**
 * Map one GET /api/v3/config/client response body onto a ClientConfig.
 *
 * Split out of the hook so it can be tested without a DOM: this is where the
 * numeric coercions live, and a missing or malformed field used to become
 * NaN silently, which reaches a setInterval as "poll as fast as possible".
 * Any value that does not resolve to a finite number falls back to the
 * compiled default for that field rather than propagating NaN.
 */
export function parseClientConfig(data: unknown): ClientConfig {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (value: unknown, fallback: number, scale = 1): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n * scale : fallback;
  };
  const DAY_SECONDS = 24 * 60 * 60;
  return {
    versionCookieMaxAgeSeconds: num(
      d.versionCookieMaxAgeDays,
      DEFAULT_CLIENT_CONFIG.versionCookieMaxAgeSeconds,
      DAY_SECONDS,
    ),
    notificationPollIntervalMs: num(
      d.notificationPollIntervalMs,
      DEFAULT_CLIENT_CONFIG.notificationPollIntervalMs,
    ),
    notificationDefaultDismissMaxAgeSeconds: num(
      d.notificationDefaultDismissDays,
      DEFAULT_CLIENT_CONFIG.notificationDefaultDismissMaxAgeSeconds,
      DAY_SECONDS,
    ),
    browserbaseLogsPollIntervalMs: num(
      d.browserbaseLogsPollIntervalMs,
      DEFAULT_CLIENT_CONFIG.browserbaseLogsPollIntervalMs,
    ),
    scanStatusPollIntervalMs: num(
      d.scanStatusPollIntervalMs,
      DEFAULT_CLIENT_CONFIG.scanStatusPollIntervalMs,
    ),
    featurePdfReports: Boolean(d.featurePdfReports),
    featureDemoMode: Boolean(d.featureDemoMode),
    featureTeams: Boolean(d.featureTeams),
    featureApiKeys: Boolean(d.featureApiKeys),
    featureWebhooks: Boolean(d.featureWebhooks),
    featureScheduledScans: Boolean(d.featureScheduledScans),
    featureBulkScans: Boolean(d.featureBulkScans),
    featureEmailNotifications: Boolean(d.featureEmailNotifications),
    featureDomainVerification: Boolean(d.featureDomainVerification),
  };
}

/**
 * One resolved config and one in-flight request, shared by every component
 * that asks for it.
 *
 * This used to be per-component: a page with the header, the scan form, the
 * notification bell and a scan's action menu on it issued four identical
 * requests for the same five numbers. That was merely wasteful while the only
 * consumer of a feature flag was the PDF export item inside a dropdown the
 * user had to open. It stopped being merely wasteful once flags started
 * deciding whether a nav item exists: with a per-component fetch, every mount
 * begins at the compiled default and corrects a moment later, so a deployment
 * with a feature turned off flashes that feature's entry point on every single
 * page. Sharing the resolved value means only the first component on a cold
 * load can ever correct; every later mount and every soft navigation already
 * has the answer.
 *
 * Deliberately not cleared on navigation. These are deployment-level settings,
 * the response is cached for a minute anyway, and a stale poll interval or
 * feature flag for the rest of a tab's life is the same exposure the
 * compiled-constant fallback already had.
 */
let sharedConfig: ClientConfig | null = null;
let sharedRequest: Promise<ClientConfig | null> | null = null;

function loadClientConfig(): Promise<ClientConfig | null> {
  sharedRequest ??= fetch("/api/v3/config/client")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return null;
      sharedConfig = parseClientConfig(data);
      return sharedConfig;
    })
    .catch(() => null)
    .finally(() => {
      // Only a successful load is kept. A failed one is retried by the next
      // component to mount rather than being remembered as "no config".
      if (!sharedConfig) sharedRequest = null;
    });
  return sharedRequest;
}

/**
 * A handful of admin-editable settings (poll intervals, dismiss windows, the
 * feature flags) only matter inside client components, which can't call the
 * server-only getSetting()/getSettings() resolver directly. This hook fetches
 * the live values once from GET /api/v3/config/client and falls back to the
 * compiled defaults until it resolves (or if it fails), so an admin edit
 * reaches the browser without every poller needing its own fetch/cache logic.
 *
 * `loaded` says which of the two you are holding. Callers that only tune a
 * number (a poll interval) can ignore it: the compiled default is a working
 * value. Callers deciding whether a feature's entry point exists should read
 * it, because "the flag is off" and "the answer has not arrived" are not the
 * same fact, and the compiled default answers on behalf of the second.
 */
export function useClientConfig(): ClientConfig & { loaded: boolean } {
  const [config, setConfig] = useState<ClientConfig | null>(sharedConfig);

  useEffect(() => {
    if (sharedConfig) return;
    let cancelled = false;
    loadClientConfig().then((resolved) => {
      if (cancelled || !resolved) return;
      setConfig(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Memoised so the returned object has a stable identity between renders.
  // Callers put it in a useMemo dependency list (the header derives its nav
  // from it), and a fresh object every render would make every one of those
  // recompute on every render.
  return useMemo(
    () => ({ ...(config ?? DEFAULT_CLIENT_CONFIG), loaded: config !== null }),
    [config],
  );
}
