import { describe, it, expect } from "vitest";

import { SETTINGS_REGISTRY, type SettingKey } from "@/lib/config/registry";
import {
  SETTINGS_TABS,
  FIELDS_BY_GROUP,
  tabHasBuildTierFields,
  formatFieldValue,
  isDestructiveToggle,
  looksLikeEmail,
  looksLikeUrl,
  effectiveValueFor,
  isListSetting,
  isMultilineSetting,
  clusterSettingKeys,
} from "@/components/admin/features/settings-registry-utils";

const REGISTRY_KEYS = Object.keys(SETTINGS_REGISTRY) as SettingKey[];

describe("SETTINGS_TABS", () => {
  it("has no duplicate group names", () => {
    expect(new Set(SETTINGS_TABS).size).toBe(SETTINGS_TABS.length);
  });

  it("orders tabs by first appearance in the registry, not alphabetically", () => {
    const firstSeen: string[] = [];
    for (const def of Object.values(SETTINGS_REGISTRY)) {
      if (!firstSeen.includes(def.group)) firstSeen.push(def.group);
    }
    expect(SETTINGS_TABS).toEqual(firstSeen);
  });

  it("includes every group actually present in the registry", () => {
    const groupsInRegistry = new Set(
      Object.values(SETTINGS_REGISTRY).map((def) => def.group),
    );
    expect(new Set(SETTINGS_TABS)).toEqual(groupsInRegistry);
  });
});

describe("FIELDS_BY_GROUP", () => {
  it("buckets every registry key into exactly one group, with none dropped or duplicated", () => {
    const bucketedKeys = Object.values(FIELDS_BY_GROUP).flatMap((entries) =>
      entries.map(([key]) => key),
    );
    expect(bucketedKeys.length).toBe(REGISTRY_KEYS.length);
    expect(new Set(bucketedKeys)).toEqual(new Set(REGISTRY_KEYS));
  });

  it("puts each field under its own registry-declared group", () => {
    for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
      const bucket = FIELDS_BY_GROUP[def.group];
      expect(
        bucket.some(([k]) => k === key),
        key,
      ).toBe(true);
    }
  });

  it("has a bucket for every tab and no bucket for anything else", () => {
    expect(new Set(Object.keys(FIELDS_BY_GROUP))).toEqual(
      new Set(SETTINGS_TABS),
    );
  });
});

describe("tabHasBuildTierFields", () => {
  it("is true for a tab made entirely of build-tier fields", () => {
    expect(tabHasBuildTierFields("Branding")).toBe(true);
    expect(tabHasBuildTierFields("SEO")).toBe(true);
  });

  it("is false for a tab made entirely of runtime-tier fields", () => {
    expect(tabHasBuildTierFields("Rate Limits")).toBe(false);
    expect(tabHasBuildTierFields("Billing")).toBe(false);
  });

  it("is false for a group that does not exist", () => {
    expect(tabHasBuildTierFields("Not A Real Group")).toBe(false);
  });

  it("General is mixed tier (contact emails are runtime, app metadata is build) and reports true", () => {
    // General holds both APP_NAME (build) and SUPPORT_EMAIL (runtime); the
    // banner should show because at least one field on the tab is build-tier.
    expect(tabHasBuildTierFields("General")).toBe(true);
  });
});

describe("formatFieldValue", () => {
  it("renders booleans as Yes/No", () => {
    expect(formatFieldValue(true)).toBe("Yes");
    expect(formatFieldValue(false)).toBe("No");
  });

  it("renders numbers and strings as-is", () => {
    expect(formatFieldValue(42)).toBe("42");
    expect(formatFieldValue("high")).toBe("high");
  });
});

describe("isDestructiveToggle", () => {
  it("flags turning off BILLING_ENABLED", () => {
    expect(isDestructiveToggle("BILLING_ENABLED", false)).toBe(true);
  });

  it("flags turning off any FEATURE_* flag", () => {
    expect(isDestructiveToggle("FEATURE_TEAMS", false)).toBe(true);
    expect(isDestructiveToggle("FEATURE_API_KEYS", false)).toBe(true);
  });

  it("does not flag turning BILLING_ENABLED or a feature flag on", () => {
    expect(isDestructiveToggle("BILLING_ENABLED", true)).toBe(false);
    expect(isDestructiveToggle("FEATURE_TEAMS", true)).toBe(false);
  });

  it("does not flag a boolean outside billing/feature scope, even turned off", () => {
    expect(isDestructiveToggle("SCAN_AUTH_ENABLED", false)).toBe(false);
    expect(isDestructiveToggle("BETA_ENABLED", false)).toBe(false);
  });

  it("does not flag a non-boolean value", () => {
    expect(isDestructiveToggle("BILLING_FREE_LIMIT", 0)).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it("accepts a plausible email and an empty string", () => {
    expect(looksLikeEmail("help@example.com")).toBe(true);
    expect(looksLikeEmail("")).toBe(true);
  });

  it("rejects an obviously malformed value", () => {
    expect(looksLikeEmail("not-an-email")).toBe(false);
    expect(looksLikeEmail("missing-at.com")).toBe(false);
  });
});

describe("looksLikeUrl", () => {
  it("accepts a plausible URL and an empty string", () => {
    expect(looksLikeUrl("https://example.com")).toBe(true);
    expect(looksLikeUrl("")).toBe(true);
  });

  it("rejects an obviously malformed value", () => {
    expect(looksLikeUrl("not a url")).toBe(false);
  });
});

describe("effectiveValueFor", () => {
  it("prefers the resolved effective value over the registry default", () => {
    expect(
      effectiveValueFor("RATE_LIMIT_LOGIN_ATTEMPTS", {
        RATE_LIMIT_LOGIN_ATTEMPTS: 9,
      }),
    ).toBe(9);
  });

  it("falls back to the registry default when the key is missing from effective", () => {
    expect(effectiveValueFor("RATE_LIMIT_LOGIN_ATTEMPTS", {})).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.default,
    );
  });

  it("falls back to the default for a false boolean stored as an actual false, not treating it as missing", () => {
    expect(
      effectiveValueFor("BILLING_ENABLED", { BILLING_ENABLED: false }),
    ).toBe(false);
  });
});

describe("isListSetting", () => {
  it("flags the one known comma-separated-list setting", () => {
    expect(isListSetting("SEO_KEYWORDS")).toBe(true);
  });

  it("does not flag an ordinary string setting", () => {
    expect(isListSetting("APP_NAME")).toBe(false);
    expect(isListSetting("NOT_A_REAL_KEY")).toBe(false);
  });
});

describe("isMultilineSetting", () => {
  it("flags prose-shaped settings", () => {
    expect(isMultilineSetting("APP_DESCRIPTION")).toBe(true);
    expect(isMultilineSetting("SEO_TAGLINE")).toBe(true);
    expect(isMultilineSetting("TERMS_CHANGE_SUMMARY")).toBe(true);
    expect(isMultilineSetting("BETA_BANNER_MESSAGE")).toBe(true);
    expect(isMultilineSetting("FOOTER_TEXT")).toBe(true);
  });

  it("does not flag a short single-token string setting", () => {
    expect(isMultilineSetting("APP_NAME")).toBe(false);
    expect(isMultilineSetting("APP_SLUG")).toBe(false);
    expect(isMultilineSetting("NOT_A_REAL_KEY")).toBe(false);
  });

  it("does not flag a long value that is still a single token, like a URL", () => {
    expect(isMultilineSetting("LOGO_URL")).toBe(false);
    expect(isMultilineSetting("SEO_OG_IMAGE")).toBe(false);
  });
});

describe("clusterSettingKeys", () => {
  it("returns an empty array for an empty input", () => {
    expect(clusterSettingKeys([])).toEqual([]);
  });

  it("gives a lone key an unlabeled singleton cluster", () => {
    const result = clusterSettingKeys(["APP_NAME"] as SettingKey[]);
    expect(result).toEqual([{ label: null, keys: ["APP_NAME"] }]);
  });

  it("leaves two keys with no shared first-two-token prefix as separate unlabeled singletons", () => {
    const result = clusterSettingKeys([
      "APP_NAME",
      "SUPPORT_EMAIL",
    ] as SettingKey[]);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.label === null)).toBe(true);
    expect(result.flatMap((c) => c.keys).sort()).toEqual(
      ["APP_NAME", "SUPPORT_EMAIL"].sort(),
    );
  });

  it("clusters two keys sharing a two-token prefix under a humanized label", () => {
    const result = clusterSettingKeys([
      "BILLING_FREE_LIMIT",
      "BILLING_FREE_RETENTION",
    ] as SettingKey[]);
    expect(result).toEqual([
      {
        label: "Billing Free",
        keys: ["BILLING_FREE_LIMIT", "BILLING_FREE_RETENTION"],
      },
    ]);
  });

  it("keeps an acronym token upper-cased in the label instead of title-casing it", () => {
    const result = clusterSettingKeys([
      "SEO_OG_IMAGE",
      "SEO_OG_IMAGE_WIDTH",
      "SEO_OG_IMAGE_HEIGHT",
    ] as SettingKey[]);
    expect(result).toEqual([
      {
        label: "SEO OG Image",
        keys: ["SEO_OG_IMAGE", "SEO_OG_IMAGE_WIDTH", "SEO_OG_IMAGE_HEIGHT"],
      },
    ]);
  });

  it("escalates one segment deeper when a two-token prefix dominates the whole set, instead of merging everything into one bucket", () => {
    // Every key here starts with RATE_LIMIT, so a plain two-token bucket
    // would be one giant, useless "Rate Limit" cluster covering the whole
    // group. The escalation should split it into per-category clusters.
    const keys = [
      "RATE_LIMIT_LOGIN_ATTEMPTS",
      "RATE_LIMIT_LOGIN_WINDOW_MINUTES",
      "RATE_LIMIT_SIGNUP_ATTEMPTS",
      "RATE_LIMIT_SIGNUP_WINDOW_MINUTES",
    ] as SettingKey[];
    const result = clusterSettingKeys(keys);
    expect(result).toEqual(
      expect.arrayContaining([
        {
          label: "Rate Limit Login",
          keys: ["RATE_LIMIT_LOGIN_ATTEMPTS", "RATE_LIMIT_LOGIN_WINDOW_MINUTES"],
        },
        {
          label: "Rate Limit Signup",
          keys: [
            "RATE_LIMIT_SIGNUP_ATTEMPTS",
            "RATE_LIMIT_SIGNUP_WINDOW_MINUTES",
          ],
        },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("keeps a dominant bucket intact when escalating one segment deeper finds no further structure", () => {
    // All three keys share "AI_VERIFY" and none of them share a third
    // token, so escalating must not shatter this into three singletons.
    const keys = [
      "AI_VERIFY_MAX_TOKENS",
      "AI_VERIFY_CALL_TIMEOUT_MS",
      "AI_VERIFY_PROBE_TIMEOUT_MS",
      "AI_VERIFY_TOTAL_TIMEOUT_MS",
    ] as SettingKey[];
    const result = clusterSettingKeys(keys);
    expect(result).toEqual([{ label: "AI Verify", keys }]);
  });

  it("keeps unescalatable leftovers as unlabeled singletons alongside a successfully escalated cluster", () => {
    // "FOO_BAR" dominates 4 of these 5 keys, so it escalates one segment
    // deeper. Two of those four share a deeper prefix and become a real
    // cluster; the other two don't share anything past "FOO_BAR" with
    // each other and must fall back to unlabeled singletons rather than
    // disappearing or getting folded into the "Foo Bar Baz" cluster.
    const keys = [
      "FOO_BAR_BAZ_ONE",
      "FOO_BAR_BAZ_TWO",
      "FOO_BAR_QUX",
      "FOO_BAR_ZAP",
      "OTHER_THING",
    ] as unknown as SettingKey[];
    const result = clusterSettingKeys(keys);
    expect(result).toEqual(
      expect.arrayContaining([
        { label: "Foo Bar Baz", keys: ["FOO_BAR_BAZ_ONE", "FOO_BAR_BAZ_TWO"] },
        { label: null, keys: ["FOO_BAR_QUX"] },
        { label: null, keys: ["FOO_BAR_ZAP"] },
        { label: null, keys: ["OTHER_THING"] },
      ]),
    );
    expect(result).toHaveLength(4);
  });

  it("gives every key on a real, crowded tab exactly one home, none dropped or duplicated", () => {
    for (const tab of SETTINGS_TABS) {
      const keys = FIELDS_BY_GROUP[tab].map(([key]) => key);
      const clusters = clusterSettingKeys(keys);
      const clusteredKeys = clusters.flatMap((c) => c.keys);
      expect(clusteredKeys.sort(), tab).toEqual([...keys].sort());
    }
  });

  it("only labels a cluster when it actually has more than one member", () => {
    for (const tab of SETTINGS_TABS) {
      const keys = FIELDS_BY_GROUP[tab].map(([key]) => key);
      for (const cluster of clusterSettingKeys(keys)) {
        if (cluster.keys.length === 1) expect(cluster.label).toBeNull();
        else expect(cluster.label).not.toBeNull();
      }
    }
  });
});
