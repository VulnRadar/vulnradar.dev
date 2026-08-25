/**
 * Tests for the daily-quota system (distinct from lib/rate-limiting/rate-limit.ts,
 * which is the per-window attempt limiter and already has its own suite).
 *
 * Per this repo's mocking rule (mock at the network/DB boundary, not below
 * it — see tests/README.md), we mock `@/lib/database/db`'s pool.query and
 * exercise the real quota-resolution/increment/record logic against it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  isBillingEnabled,
  getUserPlan,
  getDailyLimit,
  getDailyRequestCount,
  incrementDailyCount,
  canMakeRequest,
  checkAndRecordRequest,
  getRateLimitHeaders,
  cleanupOldLimits,
  getUsageStats,
  PLAN_LIMITS,
} = await import("@/lib/rate-limiting/daily-limits");
const { BILLING_PLAN_LIMITS } = await import("@/lib/config/constants");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

beforeEach(() => {
  mockQuery.mockReset();
  // The settings resolver caches its DB read for 30s at module scope, which
  // would otherwise leak a settings snapshot from one test into the next.
  invalidateSettingsCache();
});

describe("isBillingEnabled", () => {
  it("resolves the shipped default when no admin override is stored", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await isBillingEnabled()).toBe(true);
  });

  it("resolves an admin-configured override from system_settings", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ key: "BILLING_ENABLED", value: "false" }],
    });
    expect(await isBillingEnabled()).toBe(false);
  });
});

describe("getUserPlan", () => {
  it("returns 'staff' for an admin role regardless of their plan column", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "admin", gifted_plan: null }],
    });
    expect(await getUserPlan(1)).toBe("staff");
  });

  it("returns 'staff' for moderator and support roles", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "moderator", gifted_plan: null }],
    });
    expect(await getUserPlan(2)).toBe("staff");

    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "support", gifted_plan: null }],
    });
    expect(await getUserPlan(3)).toBe("staff");
  });

  it("prefers an active gifted plan over the user's own plan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user", gifted_plan: "pro_supporter" }],
    });
    expect(await getUserPlan(4)).toBe("pro_supporter");
  });

  it("falls back to the user's own paid plan when there is no gift", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "core_supporter", role: "user", gifted_plan: null }],
    });
    expect(await getUserPlan(5)).toBe("core_supporter");
  });

  it("returns 'free' for a free-plan user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user", gifted_plan: null }],
    });
    expect(await getUserPlan(6)).toBe("free");
  });

  it("returns 'free' when no user row is found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserPlan(999)).toBe("free");
  });

  it("fails closed to 'free' on a DB error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));
    expect(await getUserPlan(7)).toBe("free");
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("getDailyLimit (billing enabled — shipped config)", () => {
  // getDailyLimit resolves BILLING_ENABLED/BILLING_UNLIMITED_MODE_LIMIT
  // first (one system_settings query, empty rows -> shipped defaults),
  // then getUserPlan's own query. Routing by SQL text (rather than a
  // strict mockResolvedValueOnce queue) keeps this independent of the
  // exact interleaving of those two internal queries.
  function mockPlanRow(row: Record<string, unknown>) {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      return { rows: [row] };
    });
  }

  it("resolves the free plan's numeric limit", async () => {
    mockPlanRow({ plan: "free", role: "user", gifted_plan: null });
    expect(await getDailyLimit(1)).toBe(BILLING_PLAN_LIMITS.free);
  });

  it("resolves the Pro Supporter daily limit for staff, not Infinity", async () => {
    mockPlanRow({ plan: "free", role: "admin", gifted_plan: null });
    expect(await getDailyLimit(1)).toBe(BILLING_PLAN_LIMITS.pro_supporter);
  });

  it("falls back to the free limit for an unrecognized plan string", async () => {
    mockPlanRow({
      plan: "free",
      role: "user",
      gifted_plan: "enterprise_custom",
    });
    expect(await getDailyLimit(1)).toBe(PLAN_LIMITS.free);
  });

  it("maps a plan limit of -1 to Infinity (the documented 'unlimited' sentinel)", async () => {
    // An admin sets a plan's daily cap to -1, which the admin UI documents
    // as "unlimited". The billing-disabled branch already maps -1 ->
    // Infinity; the billing-enabled branch must too. Otherwise
    // checkAndRecordRequest sees limit === -1 (not Infinity), hits its
    // `limit <= 0` guard, and denies every scan on the entire tier -- the
    // exact opposite of "unlimited".
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [{ key: "BILLING_FREE_LIMIT", value: "-1" }] };
      }
      return { rows: [{ plan: "free", role: "user", gifted_plan: null }] };
    });
    expect(await getDailyLimit(1)).toBe(Infinity);
  });

  it("allows a scan (does not deny) when the plan's cap is the -1 unlimited sentinel", async () => {
    // The user-facing consequence of the bug above: with limit -1,
    // checkAndRecordRequest must take the unlimited path, not reject.
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [{ key: "BILLING_FREE_LIMIT", value: "-1" }] };
      }
      if (s.startsWith("INSERT INTO rate_limits")) {
        return { rows: [{ new_count: "1" }] };
      }
      return { rows: [{ plan: "free", role: "user", gifted_plan: null }] };
    });
    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(true);
    // The unlimited path reports the caller-facing -1 sentinel (not the
    // internal Infinity) for limit/remaining.
    expect(result.limit).toBe(-1);
    expect(result.remaining).toBe(-1);
  });
});

describe("getDailyLimit (billing disabled)", () => {
  it("returns Infinity when unlimited_mode_limit is -1", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: "BILLING_ENABLED", value: "false" },
        { key: "BILLING_UNLIMITED_MODE_LIMIT", value: "-1" },
      ],
    });
    const result = await getDailyLimit(1);
    expect(result).toBe(Infinity);
    // Billing disabled short-circuits before ever querying the user's plan.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns the configured cap when unlimited_mode_limit is a positive number", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: "BILLING_ENABLED", value: "false" },
        { key: "BILLING_UNLIMITED_MODE_LIMIT", value: "100" },
      ],
    });
    expect(await getDailyLimit(1)).toBe(100);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("getDailyRequestCount", () => {
  it("returns the parsed running total", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: "7" }] });
    expect(await getDailyRequestCount(1)).toBe(7);
  });

  it("returns 0 when the sum is null (no rows for today)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: null }] });
    expect(await getDailyRequestCount(1)).toBe(0);
  });

  it("returns 0 on a DB error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    expect(await getDailyRequestCount(1)).toBe(0);
    logged.mockRestore();
  });

  it("scopes the query key to the given user id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: "0" }] });
    await getDailyRequestCount(42);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["daily_scan:42"]);
  });
});

describe("incrementDailyCount", () => {
  it("returns the post-increment count from the upsert", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ new_count: "3" }] });
    expect(await incrementDailyCount(1)).toBe(3);
  });

  it("returns 0 when no row comes back", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await incrementDailyCount(1)).toBe(0);
  });

  it("returns 0 on a DB error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    expect(await incrementDailyCount(1)).toBe(0);
    logged.mockRestore();
  });
});

describe("canMakeRequest", () => {
  // canMakeRequest runs getDailyLimit (settings query + getUserPlan query)
  // and getDailyRequestCount (SUM query) concurrently via Promise.all, so
  // the three underlying pool.query calls are routed by SQL text rather
  // than relying on a fixed call order.
  function mockPlanAndCount(planRow: Record<string, unknown>, total: string) {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [planRow] };
      }
      if (s.includes('SUM("count")')) {
        return { rows: [{ total }] };
      }
      return { rows: [] };
    });
  }

  it("allows when used is under the limit and reports correct remaining", async () => {
    mockPlanAndCount({ plan: "free", role: "user", gifted_plan: null }, "5");

    const result = await canMakeRequest(1);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(5);
    expect(result.limit).toBe(BILLING_PLAN_LIMITS.free);
    expect(result.remaining).toBe(BILLING_PLAN_LIMITS.free - 5);
    expect(new Date(result.resetsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("denies and floors remaining at 0 once used reaches the limit", async () => {
    mockPlanAndCount(
      { plan: "free", role: "user", gifted_plan: null },
      String(BILLING_PLAN_LIMITS.free + 10),
    );

    const result = await canMakeRequest(1);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("caps a staff account at the Pro Supporter daily limit, not unlimited", async () => {
    mockPlanAndCount(
      { plan: "free", role: "admin", gifted_plan: null },
      String(BILLING_PLAN_LIMITS.pro_supporter + 1),
    );

    const result = await canMakeRequest(1);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(BILLING_PLAN_LIMITS.pro_supporter);
    expect(result.remaining).toBe(0);
  });

  it("allows a staff account under the Pro Supporter daily limit", async () => {
    mockPlanAndCount({ plan: "free", role: "admin", gifted_plan: null }, "5");

    const result = await canMakeRequest(1);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(BILLING_PLAN_LIMITS.pro_supporter);
    expect(result.remaining).toBe(BILLING_PLAN_LIMITS.pro_supporter - 5);
  });
});

describe("checkAndRecordRequest", () => {
  // getDailyLimit (settings query + getUserPlan query) resolves first,
  // then the atomic upsert runs. Routed by SQL text for the same reason
  // as canMakeRequest above.
  function mockPlanAndUpsert(
    planRow: Record<string, unknown>,
    newCount: string,
  ) {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [planRow] };
      }
      if (s.includes("WITH ins AS")) {
        return { rows: [{ new_count: newCount }] };
      }
      return { rows: [] };
    });
  }

  it("atomically increments and allows when the new total is within the limit", async () => {
    mockPlanAndUpsert({ plan: "free", role: "user", gifted_plan: null }, "1");

    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.remaining).toBe(BILLING_PLAN_LIMITS.free - 1);
  });

  it("denies without incrementing once already at the limit, reporting the real unchanged count", async () => {
    // The WHERE guard on DO UPDATE means an already-at-cap caller gets
    // zero rows back from the CTE (see checkAndRecordRequest's own
    // comment) -- the code then re-reads the real, untouched count with a
    // plain SELECT rather than trusting a phantom incremented value.
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [{ plan: "free", role: "user", gifted_plan: null }] };
      }
      if (s.includes("WITH ins AS")) {
        return { rows: [] }; // blocked: WHERE guard skipped the update
      }
      if (s.startsWith('SELECT "count" FROM rate_limits')) {
        return { rows: [{ count: BILLING_PLAN_LIMITS.free }] };
      }
      return { rows: [] };
    });

    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(BILLING_PLAN_LIMITS.free);
    expect(result.remaining).toBe(0);
  });

  it("caps staff at the Pro Supporter daily limit and still records the increment", async () => {
    mockPlanAndUpsert({ plan: "free", role: "admin", gifted_plan: null }, "50");

    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(BILLING_PLAN_LIMITS.pro_supporter);
    expect(result.remaining).toBe(BILLING_PLAN_LIMITS.pro_supporter - 50);
    expect(result.used).toBe(50);
  });

  it("denies a staff account without incrementing once already at the Pro Supporter limit", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [{ plan: "free", role: "admin", gifted_plan: null }] };
      }
      if (s.includes("WITH ins AS")) {
        return { rows: [] };
      }
      if (s.startsWith('SELECT "count" FROM rate_limits')) {
        return { rows: [{ count: BILLING_PLAN_LIMITS.pro_supporter }] };
      }
      return { rows: [] };
    });

    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(BILLING_PLAN_LIMITS.pro_supporter);
    expect(result.used).toBe(BILLING_PLAN_LIMITS.pro_supporter);
    expect(result.remaining).toBe(0);
  });

  it("regression: repeated attempts past the limit never inflate the stored count past the cap (was: every rejected attempt still incremented it)", async () => {
    // A tiny in-memory stand-in for the rate_limits row, honoring the same
    // WHERE-guard semantics as the real SQL: the conditional UPDATE only
    // applies while count < limit. The cap used here is whatever the free
    // plan's own mocked settings resolve to, so it always matches what
    // getDailyLimit actually returns.
    const realLimit = BILLING_PLAN_LIMITS.free;
    let storedCount: number | null = null;

    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [{ plan: "free", role: "user", gifted_plan: null }] };
      }
      if (s.includes("WITH ins AS")) {
        if (storedCount === null) {
          storedCount = 1;
          return { rows: [{ new_count: String(storedCount) }] };
        }
        if (storedCount < realLimit) {
          storedCount += 1;
          return { rows: [{ new_count: String(storedCount) }] };
        }
        return { rows: [] }; // WHERE guard blocks the update
      }
      if (s.startsWith('SELECT "count" FROM rate_limits')) {
        return { rows: [{ count: storedCount }] };
      }
      return { rows: [] };
    });

    storedCount = realLimit - 1; // one request away from the cap

    const first = await checkAndRecordRequest(1); // reaches the cap exactly
    expect(first.allowed).toBe(true);
    expect(first.used).toBe(realLimit);

    const second = await checkAndRecordRequest(1); // already at cap
    const third = await checkAndRecordRequest(1); // still at cap
    expect(second.allowed).toBe(false);
    expect(third.allowed).toBe(false);
    expect(second.used).toBe(realLimit);
    expect(third.used).toBe(realLimit);
    // The stored count itself never exceeded the cap, no matter how many
    // more times a request was rejected.
    expect(storedCount).toBe(realLimit);
  });

  it("fails closed (denies, does not issue a permit) when the atomic increment query throws", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockImplementation(async (sql: string) => {
      const s = String(sql).trim();
      if (s.startsWith("SELECT key, value FROM system_settings")) {
        return { rows: [] };
      }
      if (s.includes("LEFT JOIN gifted_subscriptions gs")) {
        return { rows: [{ plan: "free", role: "user", gifted_plan: null }] };
      }
      if (s.includes("WITH ins AS")) {
        throw new Error("deadlock");
      }
      return { rows: [] };
    });

    const result = await checkAndRecordRequest(1);
    expect(result.allowed).toBe(false);
    expect(result.used).toBe(0);
    logged.mockRestore();
  });
});

describe("getRateLimitHeaders", () => {
  it("renders numeric limit/remaining as strings", () => {
    const headers = getRateLimitHeaders({
      used: 3,
      limit: 25,
      remaining: 22,
      resetsAt: "2026-01-01T00:00:00.000Z",
    });
    expect(headers["X-RateLimit-Limit"]).toBe("25");
    expect(headers["X-RateLimit-Remaining"]).toBe("22");
    expect(headers["X-RateLimit-Used"]).toBe("3");
    expect(headers["X-RateLimit-Reset"]).toBe("2026-01-01T00:00:00.000Z");
    expect(headers["X-RateLimit-Policy"]).toBe("daily");
  });

  it("renders -1 sentinel values as 'unlimited'", () => {
    const headers = getRateLimitHeaders({
      used: 500,
      limit: -1,
      remaining: -1,
      resetsAt: "2026-01-01T00:00:00.000Z",
    });
    expect(headers["X-RateLimit-Limit"]).toBe("unlimited");
    expect(headers["X-RateLimit-Remaining"]).toBe("unlimited");
    expect(headers["X-RateLimit-Used"]).toBe("500");
  });
});

describe("cleanupOldLimits", () => {
  it("returns the number of deleted rows", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 12 });
    expect(await cleanupOldLimits()).toBe(12);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([7]); // default daysToKeep
  });

  it("passes a custom daysToKeep through to the query", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 3 });
    await cleanupOldLimits(30);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([30]);
  });

  it("returns 0 when rowCount is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null });
    expect(await cleanupOldLimits()).toBe(0);
  });

  it("returns 0 on a DB error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    expect(await cleanupOldLimits()).toBe(0);
    logged.mockRestore();
  });
});

describe("getUsageStats", () => {
  it("returns the per-day rows from scan_history", async () => {
    const rows = [
      { date: "2026-01-01", count: "2" },
      { date: "2026-01-02", count: "5" },
    ];
    mockQuery.mockResolvedValueOnce({ rows });
    expect(await getUsageStats(1)).toEqual(rows);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([1, 30]); // default days
  });

  it("passes a custom days window through to the query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await getUsageStats(1, 7);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([1, 7]);
  });

  it("returns [] on a DB error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("boom"));
    expect(await getUsageStats(1)).toEqual([]);
    logged.mockRestore();
  });
});
