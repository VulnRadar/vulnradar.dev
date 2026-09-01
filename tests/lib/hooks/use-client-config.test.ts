import { describe, it, expect } from "vitest";
import {
  parseClientConfig,
  DEFAULT_CLIENT_CONFIG,
} from "@/lib/hooks/use-client-config";

/**
 * The hook itself needs a DOM to exercise; the part that can actually be
 * wrong without one is the mapping from the GET /api/v3/config/client body
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
