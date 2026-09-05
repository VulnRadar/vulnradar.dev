/**
 * Which UI surface each client feature flag turns off.
 *
 * The gap this closes: nine feature flags were resolved server-side, shipped
 * to the browser and parsed into a typed ClientConfig, and exactly one of them
 * (PDF reports) was ever read by a component. Turning any other feature off
 * left its nav item, tab and form fully present, and the user found out from a
 * 403 on submit. These are the predicates the entry points now consult.
 *
 * There is no DOM environment in this tier (vitest.config.ts runs `node`, and
 * a .tsx module cannot be imported here at all because tsconfig sets
 * "jsx": "preserve"), so the policy lives in plain .ts and is tested here
 * directly, the same split components/history/history-filter-utils.ts uses.
 */
import { describe, it, expect } from "vitest";
import {
  DEVELOPER_SURFACES,
  developerTabEnabled,
  isSurfaceEnabled,
  profileTabEnabled,
  resolveDeveloperSection,
  resolveScanMode,
  visibleSurfaces,
  type FeatureFlags,
  type FeatureSurface,
} from "@/lib/config/feature-surfaces";
import { DEFAULT_CLIENT_CONFIG } from "@/lib/hooks/use-client-config";

const ALL_ON: FeatureFlags = {
  featureTeams: true,
  featureApiKeys: true,
  featureWebhooks: true,
  featureScheduledScans: true,
  featureBulkScans: true,
  featureDemoMode: true,
  featureEmailNotifications: true,
  featureDomainVerification: true,
};

const ALL_OFF: FeatureFlags = {
  featureTeams: false,
  featureApiKeys: false,
  featureWebhooks: false,
  featureScheduledScans: false,
  featureBulkScans: false,
  featureEmailNotifications: false,
  featureDemoMode: false,
  featureDomainVerification: false,
};

const off = (...keys: (keyof FeatureFlags)[]): FeatureFlags => ({
  ...ALL_ON,
  ...Object.fromEntries(keys.map((k) => [k, false])),
});

const SURFACES: FeatureSurface[] = [
  "teams",
  "apiKeys",
  "webhooks",
  "schedules",
  "bulkScans",
  "demoMode",
  "emailNotifications",
  "domainVerification",
];

describe("isSurfaceEnabled", () => {
  it("maps every surface to a distinct flag", () => {
    // Each surface reads exactly one flag, and turning that one flag off is
    // enough to disable it. A copy-paste in the table would show up here as a
    // surface that survives its own flag or dies with someone else's.
    const flagFor: Record<string, keyof FeatureFlags> = {
      teams: "featureTeams",
      apiKeys: "featureApiKeys",
      webhooks: "featureWebhooks",
      schedules: "featureScheduledScans",
      bulkScans: "featureBulkScans",
      demoMode: "featureDemoMode",
      emailNotifications: "featureEmailNotifications",
      domainVerification: "featureDomainVerification",
    };
    for (const surface of SURFACES) {
      expect(isSurfaceEnabled(surface, ALL_ON), surface).toBe(true);
      expect(isSurfaceEnabled(surface, off(flagFor[surface])), surface).toBe(
        false,
      );
      // ...and only that one: every other surface is untouched by it.
      for (const other of SURFACES.filter((s) => s !== surface)) {
        expect(
          isSurfaceEnabled(other, off(flagFor[surface])),
          `${surface} off should not disable ${other}`,
        ).toBe(true);
      }
    }
  });

  it("accepts a real ClientConfig, so the hook's shape and this table cannot drift", () => {
    // Structural, not nominal: if a flag is renamed in ClientConfig without
    // being renamed here, this stops compiling.
    for (const surface of SURFACES) {
      expect(typeof isSurfaceEnabled(surface, DEFAULT_CLIENT_CONFIG)).toBe(
        "boolean",
      );
    }
  });
});

describe("visibleSurfaces", () => {
  // Shaped like the real tables: the header nav, the history tab strip and the
  // Developer sub-tabs are all lists where most entries carry no feature and a
  // few do.
  const NAV = [
    { href: "/dashboard", label: "Scanner" },
    { href: "/history", label: "History" },
    { href: "/teams", label: "Teams", feature: "teams" as const },
    { href: "/profile", label: "Profile" },
  ];

  it("keeps everything when the flags are on", () => {
    expect(visibleSurfaces(NAV, ALL_ON).map((l) => l.label)).toEqual([
      "Scanner",
      "History",
      "Teams",
      "Profile",
    ]);
  });

  it("drops the entry whose feature is off and leaves no hole behind it", () => {
    const visible = visibleSurfaces(NAV, off("featureTeams"));
    expect(visible.map((l) => l.label)).toEqual([
      "Scanner",
      "History",
      "Profile",
    ]);
    // The point of removing rather than disabling: nothing in the list is a
    // placeholder for the thing that is gone.
    expect(visible.some((l) => l.href === "/teams")).toBe(false);
  });

  it("never drops an entry that declares no feature, even with every flag off", () => {
    expect(visibleSurfaces(NAV, ALL_OFF).map((l) => l.label)).toEqual([
      "Scanner",
      "History",
      "Profile",
    ]);
  });
});

describe("developerTabEnabled", () => {
  it("survives on any one of its three features", () => {
    for (const surface of DEVELOPER_SURFACES) {
      const onlyThisOne: FeatureFlags = {
        ...ALL_OFF,
        featureApiKeys: surface === "apiKeys",
        featureWebhooks: surface === "webhooks",
        featureScheduledScans: surface === "schedules",
      };
      expect(developerTabEnabled(onlyThisOne), surface).toBe(true);
    }
  });

  it("goes when all three are off, rather than leaving an empty panel", () => {
    expect(
      developerTabEnabled(
        off("featureApiKeys", "featureWebhooks", "featureScheduledScans"),
      ),
    ).toBe(false);
  });

  it("is not affected by the other flags", () => {
    expect(
      developerTabEnabled(
        off(
          "featureTeams",
          "featureBulkScans",
          "featureDemoMode",
          "featureEmailNotifications",
          "featureDomainVerification",
        ),
      ),
    ).toBe(true);
  });
});

describe("profileTabEnabled", () => {
  it("keeps the tabs that are not a feature at all", () => {
    for (const tab of [
      "general",
      "security",
      "social",
      "billing",
      "privacy",
      "ai",
    ]) {
      expect(profileTabEnabled(tab, ALL_OFF), tab).toBe(true);
    }
  });

  it("hides Notifications when email notifications are off", () => {
    expect(profileTabEnabled("notifications", ALL_ON)).toBe(true);
    expect(
      profileTabEnabled("notifications", off("featureEmailNotifications")),
    ).toBe(false);
  });

  it("hides Developer only when all three of its features are off", () => {
    expect(profileTabEnabled("developer", off("featureApiKeys"))).toBe(true);
    expect(
      profileTabEnabled(
        "developer",
        off("featureApiKeys", "featureWebhooks", "featureScheduledScans"),
      ),
    ).toBe(false);
  });
});

describe("resolveDeveloperSection", () => {
  it("honours a requested section that is enabled", () => {
    expect(resolveDeveloperSection("webhooks", ALL_ON)).toBe("webhooks");
    expect(resolveDeveloperSection("schedules", ALL_ON)).toBe("schedules");
  });

  it("falls back to API keys when nothing is requested", () => {
    expect(resolveDeveloperSection(null, ALL_ON)).toBe("api-keys");
  });

  it("does not fall back onto the disabled section", () => {
    // The bug this exists to prevent: "api-keys" was the unconditional
    // fallback, so with API keys off every visitor landed on the one section
    // the deployment had turned off.
    expect(resolveDeveloperSection(null, off("featureApiKeys"))).toBe(
      "webhooks",
    );
    expect(
      resolveDeveloperSection(null, off("featureApiKeys", "featureWebhooks")),
    ).toBe("schedules");
  });

  it("redirects a bookmark pointing at a disabled section", () => {
    expect(resolveDeveloperSection("webhooks", off("featureWebhooks"))).toBe(
      "api-keys",
    );
  });

  it("returns null when every section is off, so the caller can say so", () => {
    const none = off(
      "featureApiKeys",
      "featureWebhooks",
      "featureScheduledScans",
    );
    expect(resolveDeveloperSection(null, none)).toBe(null);
    expect(resolveDeveloperSection("webhooks", none)).toBe(null);
  });

  it("keeps the ?dtab=domains pointer alive only while domain verification is on", () => {
    // "domains" is not a real section: it renders a card pointing at
    // /attack-surface so an old bookmark lands somewhere useful. With domain
    // verification off there is nothing to point at.
    expect(resolveDeveloperSection("domains", ALL_ON)).toBe("domains");
    expect(
      resolveDeveloperSection("domains", off("featureDomainVerification")),
    ).toBe("api-keys");
  });
});

describe("resolveScanMode", () => {
  it("leaves the unflagged modes alone", () => {
    expect(resolveScanMode("quick", ALL_OFF, "quick")).toBe("quick");
    expect(resolveScanMode("deep", ALL_OFF, "quick")).toBe("deep");
  });

  it("keeps bulk when the feature is on", () => {
    expect(resolveScanMode("bulk", ALL_ON, "quick")).toBe("bulk");
  });

  it("sends ?mode=bulk back to quick when bulk scanning is off", () => {
    // Otherwise the form selects a tab that is no longer in the mode strip,
    // and the user pastes a hundred URLs into a request the API will refuse.
    expect(resolveScanMode("bulk", off("featureBulkScans"), "quick")).toBe(
      "quick",
    );
  });
});
