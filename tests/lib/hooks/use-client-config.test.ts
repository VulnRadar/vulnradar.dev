import { describe, it, expect } from "vitest";
import {
  parseClientConfig,
  DEFAULT_CLIENT_CONFIG,
} from "@/lib/hooks/use-client-config";

/**
 * The hook's state needs a DOM to exercise (its request is covered by
 * use-client-config-request.test.ts); the part that can actually be
 * wrong without one is the mapping from the GET API.CONFIG_CLIENT body
 * onto the config object. Every poller in the app reads its interval from
 * here, so a field that silently becomes NaN turns a 30-second poll into a
 * tight loop in every open tab.
 */
describe("parseClientConfig", () => {
  it("maps a complete response, converting day fields to seconds", () => {
    const parsed = parseClientConfig({
      versionCookieMaxAgeDays: 2,
      notificationPollIntervalMs: 45000,
      notificationDefaultDismissDays: 7,
      browserbaseLogsPollIntervalMs: 2000,
      scanStatusPollIntervalMs: 1500,
      scanTimeoutSeconds: 600,
      crawlScanTimeoutSeconds: 3600,
      featurePdfReports: true,
      featureDemoMode: false,
      featureTeams: true,
      featureApiKeys: true,
      featureWebhooks: false,
      featureScheduledScans: true,
      featureBulkScans: false,
      featureEmailNotifications: true,
      featureDomainVerification: false,
    });

    expect(parsed.versionCookieMaxAgeSeconds).toBe(2 * 24 * 60 * 60);
    expect(parsed.notificationDefaultDismissMaxAgeSeconds).toBe(
      7 * 24 * 60 * 60,
    );
    expect(parsed.notificationPollIntervalMs).toBe(45000);
    expect(parsed.scanStatusPollIntervalMs).toBe(1500);
    expect(parsed.scanTimeoutSeconds).toBe(600);
    expect(parsed.crawlScanTimeoutSeconds).toBe(3600);
    expect(parsed.featureTeams).toBe(true);
    expect(parsed.featureWebhooks).toBe(false);
  });

  it("falls back to the compiled default instead of producing NaN", () => {
    const parsed = parseClientConfig({
      notificationPollIntervalMs: "not-a-number",
      scanStatusPollIntervalMs: null,
      versionCookieMaxAgeDays: undefined,
    });

    expect(parsed.notificationPollIntervalMs).toBe(
      DEFAULT_CLIENT_CONFIG.notificationPollIntervalMs,
    );
    // null coerces to 0 through Number(), which is finite, so it is taken at
    // face value; undefined is not, and falls back.
    expect(Number.isFinite(parsed.scanStatusPollIntervalMs)).toBe(true);
    expect(parsed.versionCookieMaxAgeSeconds).toBe(
      DEFAULT_CLIENT_CONFIG.versionCookieMaxAgeSeconds,
    );
  });

  it("treats an empty or missing body as all-defaults for the numbers", () => {
    for (const body of [undefined, null, {}]) {
      const parsed = parseClientConfig(body);
      expect(parsed.notificationPollIntervalMs).toBe(
        DEFAULT_CLIENT_CONFIG.notificationPollIntervalMs,
      );
      expect(parsed.browserbaseLogsPollIntervalMs).toBe(
        DEFAULT_CLIENT_CONFIG.browserbaseLogsPollIntervalMs,
      );
    }
  });

  it("keeps the scan budgets positive, because the dashboard waits that long", () => {
    // Zero or a negative number would make the dashboard give up on a scan the
    // moment it starts, so unlike the intervals these do not take a bad value
    // at face value.
    for (const bad of [0, -5, "soon", null, undefined, NaN]) {
      const parsed = parseClientConfig({
        scanTimeoutSeconds: bad,
        crawlScanTimeoutSeconds: bad,
      });
      expect(parsed.scanTimeoutSeconds).toBe(
        DEFAULT_CLIENT_CONFIG.scanTimeoutSeconds,
      );
      expect(parsed.crawlScanTimeoutSeconds).toBe(
        DEFAULT_CLIENT_CONFIG.crawlScanTimeoutSeconds,
      );
    }
  });

  it("falls back to the compiled scan budgets when the response has none", () => {
    // An older deployment that does not send them yet: the defaults are the
    // budgets the scanner shipped with, which is what its watchdog uses.
    const parsed = parseClientConfig({});
    expect(parsed.scanTimeoutSeconds).toBe(300);
    expect(parsed.crawlScanTimeoutSeconds).toBe(900);
  });

  it("fails a missing feature flag closed rather than open", () => {
    // An absent flag must not read as "enabled": the server is the authority
    // and an older deployment that does not send a flag should not have the
    // browser assume the feature is on.
    const parsed = parseClientConfig({});
    expect(parsed.featureTeams).toBe(false);
    expect(parsed.featurePdfReports).toBe(false);
    expect(parsed.featureWebhooks).toBe(false);
  });

  it("ships every flag the config route sends", () => {
    // A flag added to the route but forgotten here would leave its UI stuck
    // on the compiled default forever.
    expect(
      Object.keys(DEFAULT_CLIENT_CONFIG).filter((k) => k.startsWith("feature")),
    ).toEqual([
      "featurePdfReports",
      "featureDemoMode",
      "featureTeams",
      "featureApiKeys",
      "featureWebhooks",
      "featureScheduledScans",
      "featureBulkScans",
      "featureEmailNotifications",
      "featureDomainVerification",
    ]);
  });
});
