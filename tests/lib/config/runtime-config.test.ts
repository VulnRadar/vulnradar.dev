import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Resolver tests. The pg pool is mocked at the module boundary; everything
 * below it (the registry, the coercion, the cache) is the real code.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
const { getSetting, getSettings, invalidateSettingsCache } =
  await import("@/lib/config/runtime-config");

type Row = { key: string; value: string };

const rows = (...values: Row[]) => ({ rows: values });

const REGISTRY_KEYS = Object.keys(
  SETTINGS_REGISTRY,
) as (keyof typeof SETTINGS_REGISTRY)[];
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  mockQuery.mockReset();
  invalidateSettingsCache();
  // A real deployment may export some of these names. Clear them so a test
  // only sees the override it sets itself.
  for (const key of REGISTRY_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  vi.useRealTimers();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("fresh install", () => {
  it("returns the shipped default for every setting when the table is empty", async () => {
    mockQuery.mockResolvedValue(rows());

    for (const key of REGISTRY_KEYS) {
      expect(await getSetting(key), key).toBe(SETTINGS_REGISTRY[key].default);
    }
  });

  it("loads the whole table in one query rather than one query per key", async () => {
    mockQuery.mockResolvedValue(rows());

    await getSettings([
      "RATE_LIMIT_LOGIN_ATTEMPTS",
      "RATE_LIMIT_LOGIN_WINDOW_MINUTES",
      "BILLING_ENABLED",
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("FROM system_settings");
    expect(String(sql)).not.toContain("WHERE");
    expect(params).toBe(undefined);
  });

  it("shares one query between concurrent resolves", async () => {
    mockQuery.mockResolvedValue(rows());

    await Promise.all([
      getSetting("RATE_LIMIT_LOGIN_ATTEMPTS"),
      getSetting("BILLING_ENABLED"),
      getSetting("FEATURE_TEAMS"),
    ]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("resolution order", () => {
  it("prefers the database value over the environment override", async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "9";
    mockQuery.mockResolvedValue(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "3" }),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(3);
  });

  it("prefers the environment override over the shipped default", async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "9";
    mockQuery.mockResolvedValue(rows());

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(9);
  });

  it("ignores an empty environment override", async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "";
    mockQuery.mockResolvedValue(rows());

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.default,
    );
  });

  it("ignores an environment override that fails validation", async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "0";
    mockQuery.mockResolvedValue(rows());

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.default,
    );
  });
});

describe("type coercion", () => {
  it("coerces stored TEXT into the declared type", async () => {
    mockQuery.mockResolvedValue(
      rows(
        { key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "17" },
        { key: "BILLING_ENABLED", value: "false" },
        { key: "SUPPORT_EMAIL", value: "help@example.com" },
        { key: "DEFAULT_SEVERITY_THRESHOLD", value: "high" },
      ),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(17);
    expect(await getSetting("BILLING_ENABLED")).toBe(false);
    expect(await getSetting("SUPPORT_EMAIL")).toBe("help@example.com");
    expect(await getSetting("DEFAULT_SEVERITY_THRESHOLD")).toBe("high");
  });

  it("falls back to the default when a stored row is malformed", async () => {
    mockQuery.mockResolvedValue(
      rows(
        { key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "banana" },
        { key: "BILLING_ENABLED", value: "yes" },
      ),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.default,
    );
    expect(await getSetting("BILLING_ENABLED")).toBe(
      SETTINGS_REGISTRY.BILLING_ENABLED.default,
    );
  });

  it("ignores rows whose key is not in the registry", async () => {
    mockQuery.mockResolvedValue(
      rows(
        { key: "maintenance_mode", value: "true" },
        { key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" },
      ),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
  });
});

describe("caching", () => {
  it("serves a second resolve from the cache without re-querying", async () => {
    mockQuery.mockResolvedValue(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("re-reads the table once the TTL has expired", async () => {
    vi.useFakeTimers();
    mockQuery.mockResolvedValueOnce(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }),
    );
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);

    vi.advanceTimersByTime(29_000);
    mockQuery.mockResolvedValueOnce(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "8" }),
    );
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("picks up a write immediately after invalidateSettingsCache", async () => {
    mockQuery.mockResolvedValueOnce(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }),
    );
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);

    mockQuery.mockResolvedValueOnce(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "8" }),
    );
    invalidateSettingsCache();

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("fail open", () => {
  it("falls back to defaults and logs when the query throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_LOGIN_ATTEMPTS.default,
    );
    // The flags a failed read must not silently turn off.
    expect(await getSetting("BILLING_ENABLED")).toBe(true);
    expect(await getSetting("FEATURE_TEAMS")).toBe(true);
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it("still honours the environment override while the database is down", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "9";
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(9);

    logged.mockRestore();
  });
});

describe("TERMS_UPDATED_AT (ToS re-accept flow)", () => {
  it("resolves an admin's database-saved terms date instead of the shipped default -- the mechanism the re-accept prompt relies on to work without a rebuild", async () => {
    mockQuery.mockResolvedValue(
      rows({ key: "TERMS_UPDATED_AT", value: "2026-09-01" }),
    );

    expect(await getSetting("TERMS_UPDATED_AT")).toBe("2026-09-01");
    expect(await getSetting("TERMS_UPDATED_AT")).not.toBe(
      SETTINGS_REGISTRY.TERMS_UPDATED_AT.default,
    );
  });

  it("resolves the shipped default when no admin override has been saved", async () => {
    mockQuery.mockResolvedValue(rows());

    expect(await getSetting("TERMS_UPDATED_AT")).toBe(
      SETTINGS_REGISTRY.TERMS_UPDATED_AT.default,
    );
  });

  it("resolves the change-summary setting alongside the date from one snapshot", async () => {
    mockQuery.mockResolvedValue(
      rows(
        { key: "TERMS_UPDATED_AT", value: "2026-09-01" },
        {
          key: "TERMS_CHANGE_SUMMARY",
          value: "Added a data retention clause.",
        },
      ),
    );

    const resolved = await getSettings([
      "TERMS_UPDATED_AT",
      "TERMS_CHANGE_SUMMARY",
    ] as const);

    expect(resolved.TERMS_UPDATED_AT).toBe("2026-09-01");
    expect(resolved.TERMS_CHANGE_SUMMARY).toBe(
      "Added a data retention clause.",
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("getSettings", () => {
  it("resolves several keys from one snapshot", async () => {
    mockQuery.mockResolvedValue(
      rows(
        { key: "RATE_LIMIT_SCAN_REQUESTS", value: "250" },
        { key: "BILLING_ENABLED", value: "false" },
      ),
    );

    const resolved = await getSettings([
      "RATE_LIMIT_SCAN_REQUESTS",
      "RATE_LIMIT_SCAN_WINDOW_MINUTES",
      "BILLING_ENABLED",
    ]);

    expect(resolved.RATE_LIMIT_SCAN_REQUESTS).toBe(250);
    expect(resolved.RATE_LIMIT_SCAN_WINDOW_MINUTES).toBe(
      SETTINGS_REGISTRY.RATE_LIMIT_SCAN_WINDOW_MINUTES.default,
    );
    expect(resolved.BILLING_ENABLED).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
