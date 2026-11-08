import { describe, it, expect, beforeEach, vi } from "vitest";

/**
tests for the rate-limit window logic.
 *
 * The rate-limit module is the only one we test that touches the
 * database. We mock the pg pool so the test is hermetic and fast.
 */

// Mock pg pool BEFORE importing the module under test.
const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// checkRateLimit resolves the caller's IP through request-utils.
vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const { checkRateLimit, getRateLimit, RATE_LIMITS } =
  await import("@/lib/rate-limiting/rate-limit");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

beforeEach(() => {
  mockQuery.mockReset();
  invalidateSettingsCache();
});

describe("the reputation and authMe named limits", () => {
  it.each([
    ["reputation", 600, 3600],
    ["authMe", 60, 60],
  ] as const)(
    "%s ships at %i attempts per %i seconds",
    async (name, maxAttempts, windowSeconds) => {
      mockQuery.mockResolvedValue({ rows: [] });

      expect(await getRateLimit(name)).toEqual({ maxAttempts, windowSeconds });
      expect(RATE_LIMITS[name]).toEqual({
        limit: name,
        maxAttempts,
        windowSeconds,
      });
    },
  );

  it.each([
    [
      "reputation",
      "RATE_LIMIT_REPUTATION_REQUESTS",
      "RATE_LIMIT_REPUTATION_WINDOW_MINUTES",
    ],
    [
      "authMe",
      "RATE_LIMIT_AUTH_ME_REQUESTS",
      "RATE_LIMIT_AUTH_ME_WINDOW_MINUTES",
    ],
  ] as const)(
    "%s follows the values saved in the admin settings",
    async (name, attemptsKey, windowKey) => {
      mockQuery.mockResolvedValue({
        rows: [
          { key: attemptsKey, value: "7" },
          { key: windowKey, value: "3" },
        ],
      });

      expect(await getRateLimit(name)).toEqual({
        maxAttempts: 7,
        windowSeconds: 180,
      });
    },
  );
});

function sqlOf(call: unknown[]): string {
  return String(call[0]);
}

describe("checkRateLimit", () => {
  it("allows the first attempt in a window, then trims older buckets for this key", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkRateLimit({
      key: "test:1",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
    expect(result.retryAfterSeconds).toBe(0);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(sqlOf(mockQuery.mock.calls[0])).toContain("INSERT INTO rate_limits");
    const [deleteSql, deleteParams] = mockQuery.mock.calls[1];
    expect(String(deleteSql)).toContain("DELETE FROM rate_limits");
    expect(deleteParams[0]).toBe("test:1");
  });

  it("increments under the cap in one statement and leaves the older buckets alone", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] });

    const result = await checkRateLimit({
      key: "test:3",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("makes the cap part of the upsert, so a full bucket writes nothing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "2" }] });

    await checkRateLimit({
      key: "test:guard",
      maxAttempts: 7,
      windowSeconds: 60,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(
      /DO UPDATE SET "count" = rate_limits\."count" \+ 1\s+WHERE rate_limits\."count" < \$3/,
    );
    expect(params[0]).toBe("test:guard");
    expect(params[2]).toBe(7);
  });

  it("denies on zero rows with one statement and reports retryAfter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await checkRateLimit({
      key: "test:2",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
    // No rollback UPDATE: there was never an over-count to take back.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sqlOf(mockQuery.mock.calls[0])).not.toContain("UPDATE rate_limits");
  });

  it("reports the last allowed attempt as allowed with none remaining", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    const result = await checkRateLimit({
      key: "test:last",
      maxAttempts: 3,
      windowSeconds: 60,
    });

    expect(result).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
  });

  // A fresh INSERT is not subject to the DO UPDATE's WHERE, so without this
  // the first attempt against a cap of zero would write count=1 and pass.
  it.each([0, -1])(
    "denies a cap of %i without touching the table",
    async (maxAttempts) => {
      const result = await checkRateLimit({
        key: "test:zero",
        maxAttempts,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );
});
