"use client";

import { useEffect, useState } from "react";
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
 * A handful of admin-editable settings (poll intervals, dismiss windows, the
 * feature flags) only matter inside client components, which can't call the
 * server-only getSetting()/getSettings() resolver directly. This hook fetches
 * the live values once from GET /api/v3/config/client and falls back to the
 * compiled defaults until it resolves (or if it fails), so an admin edit
 * reaches the browser without every poller needing its own fetch/cache logic.
 */
export function useClientConfig(): ClientConfig {
  const [config, setConfig] = useState<ClientConfig>(DEFAULT_CLIENT_CONFIG);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v3/config/client")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setConfig(parseClientConfig(data));
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
