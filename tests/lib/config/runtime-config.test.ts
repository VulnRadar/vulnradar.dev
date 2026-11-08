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
const { getSetting, getSettings, getStoredSetting, invalidateSettingsCache } =
  await import("@/lib/config/runtime-config");

type Row = { key: string; value: string };

const rows = (...values: Row[]) => ({ rows: values });

const REGISTRY_KEYS = Object.keys(
  SETTINGS_REGISTRY,
) as (keyof typeof SETTINGS_REGISTRY)[];
const savedEnv = new Map<string, string | undefined>();

// invalidateSettingsCache keeps the values on purpose, so a test that needs
// a process that has never loaded anything has to reach the shared state.
function forgetLastGoodSnapshot() {
  const store = globalThis as unknown as Record<
    symbol,
    { snapshot: unknown; inFlight: unknown } | undefined
  >;
  const state = store[Symbol.for("vulnradar.runtimeConfig")];
  if (state) {
    state.snapshot = null;
    state.inFlight = null;
  }
}

beforeEach(() => {
  mockQuery.mockReset();
  invalidateSettingsCache();
  forgetLastGoodSnapshot();
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
      ),
    );

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(17);
    expect(await getSetting("BILLING_ENABLED")).toBe(false);
    expect(await getSetting("SUPPORT_EMAIL")).toBe("help@example.com");
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

  // Next bundles this module more than once per server process. Each copy is
  // a fresh module evaluation, which vi.resetModules() reproduces here.
  describe("across copies of the module", () => {
    async function freshCopy() {
      vi.resetModules();
      return import("@/lib/config/runtime-config");
    }

    it("serves a second copy from the snapshot the first one loaded", async () => {
      mockQuery.mockResolvedValue(
        rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }),
      );
      expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);

      const other = await freshCopy();
      expect(await other.getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("drops the snapshot for every copy when one invalidates", async () => {
      mockQuery.mockResolvedValueOnce(
        rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }),
      );
      expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);

      const other = await freshCopy();
      mockQuery.mockResolvedValueOnce(
        rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "8" }),
      );
      other.invalidateSettingsCache();

      expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it("shares one in-flight query between copies", async () => {
      let release!: (value: unknown) => void;
      mockQuery.mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const first = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");
      const other = await freshCopy();
      const second = other.getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");
      release(rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "7" }));

      expect(await Promise.all([first, second])).toEqual([7, 7]);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getStoredSetting", () => {
  it("returns only the saved value, never the environment or the default", async () => {
    process.env.RATE_LIMIT_LOGIN_ATTEMPTS = "9";
    mockQuery.mockResolvedValue(rows());
    expect(await getStoredSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBeUndefined();

    mockQuery.mockResolvedValue(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "3" }),
    );
    invalidateSettingsCache();
    expect(await getStoredSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(3);
  });

  it("returns undefined for a saved row that fails validation", async () => {
    mockQuery.mockResolvedValue(
      rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value: "0" }),
    );
    expect(await getStoredSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBeUndefined();
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

// A blip used to replace the whole snapshot with an empty map for a full TTL,
// so a security switch an admin had turned on read as its shipped default.
describe("a failed load", () => {
  const down = () => new Error("connection terminated");
  const enforced = rows({ key: "ENFORCE_STAFF_2FA", value: "true" });
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it("keeps the last good values when the reload after the TTL rejects", async () => {
    mockQuery.mockResolvedValueOnce(enforced);
    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(true);

    vi.advanceTimersByTime(31_000);
    mockQuery.mockRejectedValueOnce(down());

    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalled();
  });

  it("keeps the last good values for getSettings and getStoredSetting too", async () => {
    mockQuery.mockResolvedValueOnce(enforced);
    await getSetting("ENFORCE_STAFF_2FA");

    vi.advanceTimersByTime(31_000);
    mockQuery.mockRejectedValue(down());

    expect(await getSettings(["ENFORCE_STAFF_2FA"])).toEqual({
      ENFORCE_STAFF_2FA: true,
    });
    expect(await getStoredSetting("ENFORCE_STAFF_2FA")).toBe(true);
  });

  it("retries after a few seconds rather than a full TTL", async () => {
    mockQuery.mockResolvedValueOnce(enforced);
    await getSetting("ENFORCE_STAFF_2FA");

    vi.advanceTimersByTime(31_000);
    mockQuery.mockRejectedValueOnce(down());
    await getSetting("ENFORCE_STAFF_2FA");
    expect(mockQuery).toHaveBeenCalledTimes(2);

    // Inside the backoff nobody re-queries, so a burst of requests during an
    // outage is not a burst of failing queries.
    vi.advanceTimersByTime(2_500);
    await getSetting("ENFORCE_STAFF_2FA");
    expect(mockQuery).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2_500);
    mockQuery.mockResolvedValueOnce(
      rows({ key: "ENFORCE_STAFF_2FA", value: "false" }),
    );
    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // A good load is back on the full TTL.
    vi.advanceTimersByTime(29_000);
    await getSetting("ENFORCE_STAFF_2FA");
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("caches a cold-start failure as defaults for the same short backoff", async () => {
    mockQuery.mockRejectedValueOnce(down());
    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(false);
    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    mockQuery.mockResolvedValueOnce(enforced);
    expect(await getSetting("ENFORCE_STAFF_2FA")).toBe(true);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateSettingsCache", () => {
  const login = (value: string) =>
    rows({ key: "RATE_LIMIT_LOGIN_ATTEMPTS", value });

  function deferred() {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it("marks the snapshot stale, so a failed reload still has the last good values", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockResolvedValueOnce(login("7"));
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);

    invalidateSettingsCache();
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("stops a load already running from overwriting a newer invalidation", async () => {
    const before = deferred();
    mockQuery.mockReturnValueOnce(before.promise);
    const slow = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");

    // The admin saves while that SELECT is on the wire with the old row.
    invalidateSettingsCache();
    mockQuery.mockResolvedValueOnce(login("8"));
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);

    before.resolve(login("7"));
    await slow;

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("re-reads when an older load finishes and nothing newer has run", async () => {
    const before = deferred();
    mockQuery.mockReturnValueOnce(before.promise);
    const slow = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");

    invalidateSettingsCache();
    before.resolve(login("7"));
    await slow;

    mockQuery.mockResolvedValueOnce(login("8"));
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("does not let an older load's failure touch a newer snapshot", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = deferred();
    mockQuery.mockReturnValueOnce(before.promise);
    const slow = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");

    invalidateSettingsCache();
    mockQuery.mockResolvedValueOnce(login("8"));
    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);

    before.reject(new Error("connection terminated"));
    await slow;

    expect(await getSetting("RATE_LIMIT_LOGIN_ATTEMPTS")).toBe(8);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });

  it("does not let an older load finishing clear a newer in-flight one", async () => {
    const older = deferred();
    const newer = deferred();
    mockQuery.mockReturnValueOnce(older.promise);
    const first = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");

    invalidateSettingsCache();
    mockQuery.mockReturnValueOnce(newer.promise);
    const second = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");

    older.resolve(login("7"));
    await first;

    // Still the newer load's turn: this caller joins it, no third query.
    const third = getSetting("RATE_LIMIT_LOGIN_ATTEMPTS");
    newer.resolve(login("8"));

    expect(await Promise.all([second, third])).toEqual([8, 8]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
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
