import { describe, it, expect } from "vitest";

import { SETTINGS_REGISTRY, type SettingKey } from "@/lib/config/registry";
import {
  SETTINGS_TABS,
  FIELDS_BY_GROUP,
  formatFieldValue,
  isDestructiveToggle,
  looksLikeEmail,
  looksLikeUrl,
  effectiveValueFor,
  isListSetting,
  isMultilineSetting,
  buildSettingBlocks,
  blockKeys,
  compiledSourceFor,
  generalizePlanHelp,
  settingMatchesQuery,
  PLAN_KEY_TOKENS,
} from "@/components/admin/features/settings-registry-utils";
import fs from "node:fs";
import path from "node:path";

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
  });

  it("does not flag a non-boolean value", () => {
    expect(isDestructiveToggle("BILLING_FREE_LIMIT", 0)).toBe(false);
  });

  // The operational switches run the other way round: turning one ON is the
  // consequential direction, and MAINTENANCE_MODE takes the product away from
  // every non-staff user within the resolver's 30 second TTL.
  it.each([
    "MAINTENANCE_MODE",
    "PAUSE_SIGNUPS",
    "PAUSE_LOGINS",
    "PAUSE_SCANNING",
  ])("flags turning %s on", (key) => {
    expect(isDestructiveToggle(key, true)).toBe(true);
  });

  it("does not flag turning an operational switch back off", () => {
    expect(isDestructiveToggle("MAINTENANCE_MODE", false)).toBe(false);
    expect(isDestructiveToggle("PAUSE_SCANNING", false)).toBe(false);
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

describe("buildSettingBlocks", () => {
  const keysOf = (tab: string) =>
    (FIELDS_BY_GROUP[tab] ?? []).map(([key]) => key);

  it("renders every setting on every tab exactly once", () => {
    for (const tab of SETTINGS_TABS) {
      const rendered = buildSettingBlocks(keysOf(tab)).flatMap(blockKeys);
      expect(new Set(rendered).size, tab).toBe(rendered.length);
      expect([...rendered].sort(), tab).toEqual([...keysOf(tab)].sort());
    }
  });

  it("folds every four-plan billing limit into one matrix", () => {
    const blocks = buildSettingBlocks(keysOf("Billing"));
    const plans = blocks.filter((b) => b.kind === "plans");
    expect(plans).toHaveLength(1);
    const metrics = plans[0].kind === "plans" ? plans[0].metrics : [];
    // Every free-plan limit has all four plans, so each becomes a matrix row.
    const freeKeys = keysOf("Billing").filter((k) =>
      k.startsWith("BILLING_FREE_"),
    );
    expect(metrics.map((m) => m.keys.FREE).sort()).toEqual(freeKeys.sort());
    for (const metric of metrics) {
      expect(metric.label).not.toMatch(/free plan/i);
      expect(metric.help).not.toMatch(/free[- ]plan/i);
      for (const token of PLAN_KEY_TOKENS) {
        expect(metric.keys[token]).toBe(`BILLING_${token}_${metric.metric}`);
      }
    }
    // The plan-less billing settings stay ordinary rows.
    expect(
      blocks.some((b) => b.kind === "field" && b.key === "BILLING_ENABLED"),
    ).toBe(true);
  });

  it("leaves a limit that is missing a plan as separate fields", () => {
    const partial: SettingKey[] = [
      "BILLING_FREE_LIMIT",
      "BILLING_CORE_SUPPORTER_LIMIT",
      "BILLING_PRO_SUPPORTER_LIMIT",
    ];
    expect(buildSettingBlocks(partial).map((b) => b.kind)).toEqual([
      "field",
      "field",
      "field",
    ]);
  });

  it("pairs each rate limit with its own window", () => {
    const blocks = buildSettingBlocks(keysOf("Rate Limits"));
    const pairs = blocks.filter((b) => b.kind === "rate");
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    for (const pair of pairs) {
      if (pair.kind !== "rate") continue;
      const prefix = pair.limit.replace(/_(ATTEMPTS|REQUESTS)$/, "");
      expect(pair.window).toBe(`${prefix}_WINDOW_MINUTES`);
    }
  });
});

describe("generalizePlanHelp", () => {
  it("rewords the free plan's help to describe any plan", () => {
    expect(
      generalizePlanHelp(
        "Scans per day on the free plan. Use -1 for unlimited.",
      ),
    ).toBe("Scans per day on this plan. Use -1 for unlimited.");
    expect(
      generalizePlanHelp("Max scans a free-plan user may have running."),
    ).toBe("Max scans a user on this plan may have running.");
  });
});

describe("settingMatchesQuery", () => {
  it("matches label, key and help, and requires every word", () => {
    expect(
      settingMatchesQuery("SESSION_TIMEOUT_DAYS", "session lifetime"),
    ).toBe(true);
    expect(
      settingMatchesQuery("RATE_LIMIT_LOGIN_ATTEMPTS", "rate_limit_login"),
    ).toBe(true);
    expect(
      settingMatchesQuery("RATE_LIMIT_LOGIN_ATTEMPTS", "rate limit login"),
    ).toBe(true);
    expect(settingMatchesQuery("SESSION_TIMEOUT_DAYS", "session webhook")).toBe(
      false,
    );
    expect(settingMatchesQuery("SESSION_TIMEOUT_DAYS", "   ")).toBe(true);
  });
});

describe("compiledSourceFor", () => {
  it("names the constant, and the env override when one exists", () => {
    expect(compiledSourceFor("APP_NAME")).toEqual({
      constant: "CONFIG_APP_NAME",
      env: null,
    });
    expect(compiledSourceFor("SOCIAL_X_URL")).toEqual({
      constant: "CONFIG_SOCIAL_X_URL",
      env: "NEXT_PUBLIC_SOCIAL_X_URL",
    });
  });

  // The read-only row tells an operator which constant and which variable to
  // change, so both have to be real. Source-text checks, since the constant
  // name is gone once the registry is imported.
  const ROOT = path.resolve(__dirname, "../../../..");
  const registrySource = fs.readFileSync(
    path.join(ROOT, "lib/config/registry.ts"),
    "utf8",
  );
  const configSources = ["constants.ts", "client-constants.ts"]
    .map((f) => fs.readFileSync(path.join(ROOT, "lib/config", f), "utf8"))
    .join("\n");

  it("every build-tier default is the CONFIG_ constant of the same name", () => {
    for (const key of REGISTRY_KEYS) {
      if (SETTINGS_REGISTRY[key].tier !== "build") continue;
      const start = registrySource.indexOf(`  ${key}: {`);
      const entry = registrySource.slice(
        start,
        registrySource.indexOf("\n  },", start),
      );
      // SEO_KEYWORDS is the constant joined, so the name may be followed by a call.
      expect(entry, key).toMatch(new RegExp(`default: CONFIG_${key}[,.]`));
    }
  });

  it("every env override named in the registry is actually read", () => {
    for (const key of REGISTRY_KEYS) {
      const env = compiledSourceFor(key).env;
      if (!env) continue;
      expect(configSources, `${key} names ${env}`).toContain(
        `process.env.${env}`,
      );
    }
  });
});
