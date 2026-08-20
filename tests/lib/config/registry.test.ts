import { describe, it, expect } from "vitest";

import * as configValues from "@/lib/config/config-values";
import {
  NEVER_CONFIGURABLE,
  SETTINGS_REGISTRY,
  coerceSettingValue,
  isSettingKey,
  validateSettingValue,
  type SettingKey,
} from "@/lib/config/registry";

const CONSTANT_NAMES = Object.keys(configValues).filter((name) =>
  name.startsWith("CONFIG_"),
);

const constantFor = (key: string): unknown =>
  (configValues as Record<string, unknown>)[`CONFIG_${key}`];

describe("registry coverage", () => {
  it("classifies every CONFIG_ constant into exactly one tier", () => {
    const unclassified: string[] = [];
    const duplicated: string[] = [];

    for (const name of CONSTANT_NAMES) {
      const key = name.slice("CONFIG_".length);
      const inRegistry = key in SETTINGS_REGISTRY;
      const inNever = key in NEVER_CONFIGURABLE;
      if (!inRegistry && !inNever) unclassified.push(key);
      if (inRegistry && inNever) duplicated.push(key);
    }

    expect(unclassified).toEqual([]);
    expect(duplicated).toEqual([]);
  });

  it("has no registry or never-configurable entry without a constant", () => {
    const orphans = [
      ...Object.keys(SETTINGS_REGISTRY),
      ...Object.keys(NEVER_CONFIGURABLE),
    ].filter((key) => constantFor(key) === undefined);

    expect(orphans).toEqual([]);
  });

  it("uses the shipped constant as every default", () => {
    for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
      const constant = constantFor(key);
      // SEO_KEYWORDS is the one list-valued constant; the registry has no
      // list type, so it is stored as a comma-separated string.
      const expected = Array.isArray(constant) ? constant.join(", ") : constant;
      expect(def.default, `default for ${key}`).toBe(expected);
    }
  });

  it("gives every default a value its own validator accepts", () => {
    for (const key of Object.keys(SETTINGS_REGISTRY) as SettingKey[]) {
      const result = validateSettingValue(
        key,
        String(SETTINGS_REGISTRY[key].default),
      );
      expect(result.ok, `default for ${key}: ${JSON.stringify(result)}`).toBe(
        true,
      );
    }
  });

  it("declares options for every enum and none for other types", () => {
    for (const [key, def] of Object.entries(SETTINGS_REGISTRY)) {
      // Cast: there may currently be zero enum-typed settings (the registry
      // type still supports "enum" for future ones), so a direct `=== "enum"`
      // would type-narrow to never and fail tsc. This invariant still guards
      // any enum setting that gets added later.
      if ((def.type as string) === "enum") {
        expect(
          (def as { options?: readonly string[] }).options?.length,
          key,
        ).toBeGreaterThan(0);
      } else {
        expect((def as { options?: readonly string[] }).options, key).toBe(
          undefined,
        );
      }
    }
  });
});

describe("TERMS_UPDATED_AT / TERMS_CHANGE_SUMMARY (ToS re-accept flow)", () => {
  it("classifies TERMS_UPDATED_AT as runtime-tier, not build-tier", () => {
    // The whole point of this setting is to trigger the re-accept prompt
    // without a rebuild; a regression back to "build" would silently
    // reintroduce the deploy requirement this feature exists to remove.
    expect(SETTINGS_REGISTRY.TERMS_UPDATED_AT.tier).toBe("runtime");
  });

  it("classifies the companion change-summary setting as runtime-tier too", () => {
    expect(SETTINGS_REGISTRY.TERMS_CHANGE_SUMMARY.tier).toBe("runtime");
  });
});

describe("isSettingKey", () => {
  it("accepts a registry key and rejects a legacy free-form key", () => {
    expect(isSettingKey("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(true);
    expect(isSettingKey("maintenance_mode")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
  });
});

describe("validateSettingValue", () => {
  it("accepts an in-range integer and returns the canonical string", () => {
    const result = validateSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", " 12 ");
    expect(result).toEqual({ ok: true, value: "12" });
  });

  it("rejects a non-numeric value for an int setting", () => {
    const result = validateSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", "five");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("RATE_LIMIT_LOGIN_ATTEMPTS");
    }
  });

  it("rejects a fractional value for an int setting", () => {
    expect(validateSettingValue("SCAN_TIMEOUT_SECONDS", "12.5").ok).toBe(false);
  });

  it("rejects a value above the registry maximum", () => {
    expect(validateSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", "1000").ok).toBe(
      false,
    );
  });

  it("rejects a value below the registry minimum", () => {
    expect(validateSettingValue("MAX_URL_LENGTH", "4").ok).toBe(false);
  });

  it("never lets an auth rate limit be set to zero", () => {
    const authLimits = [
      "RATE_LIMIT_LOGIN_ATTEMPTS",
      "RATE_LIMIT_LOGIN_WINDOW_MINUTES",
      "RATE_LIMIT_SIGNUP_ATTEMPTS",
      "RATE_LIMIT_SIGNUP_WINDOW_MINUTES",
      "RATE_LIMIT_FORGOT_PASSWORD_ATTEMPTS",
      "RATE_LIMIT_FORGOT_PASSWORD_WINDOW_MINUTES",
    ] as const;

    for (const key of authLimits) {
      expect(validateSettingValue(key, "0").ok, key).toBe(false);
      expect(validateSettingValue(key, "-1").ok, key).toBe(false);
    }
  });

  it("accepts real booleans and the two boolean strings", () => {
    expect(validateSettingValue("BILLING_ENABLED", "false")).toEqual({
      ok: true,
      value: "false",
    });
    expect(validateSettingValue("BILLING_ENABLED", true)).toEqual({
      ok: true,
      value: "true",
    });
  });

  it("rejects a truthy-looking string for a boolean setting", () => {
    expect(validateSettingValue("BILLING_ENABLED", "yes").ok).toBe(false);
    expect(validateSettingValue("FEATURE_TEAMS", "1").ok).toBe(false);
  });

  it("rejects a malformed email and accepts a real one", () => {
    expect(validateSettingValue("SUPPORT_EMAIL", "support@").ok).toBe(false);
    expect(validateSettingValue("SUPPORT_EMAIL", "help@example.com")).toEqual({
      ok: true,
      value: "help@example.com",
    });
  });

  it("rejects a non-URL for a url setting", () => {
    expect(validateSettingValue("APP_URL", "not a url").ok).toBe(false);
    expect(validateSettingValue("APP_URL", "https://scan.example.com").ok).toBe(
      true,
    );
  });

  it("rejects a string longer than the registry maximum", () => {
    expect(
      validateSettingValue("APP_DESCRIPTION", "x".repeat(501)).ok,
    ).toBe(false);
  });

  it("enforces the exact 10-character length for TERMS_UPDATED_AT (registry-level bound only; calendar validity is checked at the admin write path)", () => {
    expect(validateSettingValue("TERMS_UPDATED_AT", "2026-09-01")).toEqual({
      ok: true,
      value: "2026-09-01",
    });
    expect(validateSettingValue("TERMS_UPDATED_AT", "2026-9-1").ok).toBe(false);
  });

  it("allows TERMS_CHANGE_SUMMARY to be empty (hides the change-summary callout) up to its maximum", () => {
    expect(validateSettingValue("TERMS_CHANGE_SUMMARY", "")).toEqual({
      ok: true,
      value: "",
    });
    expect(
      validateSettingValue("TERMS_CHANGE_SUMMARY", "x".repeat(301)).ok,
    ).toBe(false);
  });
});

describe("coerceSettingValue", () => {
  it("turns stored TEXT into the declared type", () => {
    expect(coerceSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", "42")).toBe(42);
    expect(coerceSettingValue("BILLING_ENABLED", "false")).toBe(false);
    expect(coerceSettingValue("BILLING_ENABLED", "true")).toBe(true);
    expect(coerceSettingValue("SUPPORT_EMAIL", "help@example.com")).toBe(
      "help@example.com",
    );
  });

  it("returns undefined for a malformed stored row instead of throwing", () => {
    expect(coerceSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", "banana")).toBe(
      undefined,
    );
    expect(coerceSettingValue("RATE_LIMIT_LOGIN_ATTEMPTS", "0")).toBe(
      undefined,
    );
    expect(coerceSettingValue("BILLING_ENABLED", "maybe")).toBe(undefined);
  });
});
