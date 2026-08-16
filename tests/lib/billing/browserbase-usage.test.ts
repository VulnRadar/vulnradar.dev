import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

const {
  currentPeriodStart,
  getBrowserbaseSecondsUsed,
  getBrowserbaseCreditBalanceSeconds,
  addBrowserbaseCreditBalanceSeconds,
  creditBrowserbaseCreditPurchase,
  recordBrowserbaseSeconds,
  checkBrowserbaseQuota,
} = await import("@/lib/billing/browserbase-usage");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetUserPlanLimits.mockReset();
});

function planLimits(browserbaseMinutesPerMonth: number) {
  return {
    dailyScans: 25,
    apiKeys: 1,
    apiRequestsPerDay: 25,
    teams: 0,
    teamMembers: 0,
    webhooks: 0,
    scheduledScans: 0,
    bulkScanUrls: 0,
    githubReviewTokensPerWindow: 0,
    aiTokensPerWindow: 0,
    browserbaseMinutesPerMonth,
  };
}

describe("currentPeriodStart", () => {
  it("floors to the first of the UTC calendar month", () => {
    expect(currentPeriodStart(new Date("2026-08-16T22:30:00Z"))).toEqual(
      new Date("2026-08-01T00:00:00.000Z"),
    );
  });

  it("two timestamps in the same month resolve to the identical period start", () => {
    const a = currentPeriodStart(new Date("2026-08-01T00:00:00.000Z"));
    const b = currentPeriodStart(new Date("2026-08-31T23:59:59.999Z"));
    expect(a).toEqual(b);
  });

  it("a timestamp on the first of the month is its own period start", () => {
    expect(currentPeriodStart(new Date("2026-01-01T00:00:00.000Z"))).toEqual(
      new Date("2026-01-01T00:00:00.000Z"),
    );
  });
});

describe("getBrowserbaseSecondsUsed", () => {
  it("returns 0 when no row exists for the period", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(
      await getBrowserbaseSecondsUsed(1, new Date("2026-08-01T00:00:00Z")),
    ).toBe(0);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 420 }] });
    expect(
      await getBrowserbaseSecondsUsed(1, new Date("2026-08-01T00:00:00Z")),
    ).toBe(420);
  });
});

describe("getBrowserbaseCreditBalanceSeconds", () => {
  it("returns 0 when the user row has no balance set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getBrowserbaseCreditBalanceSeconds(1)).toBe(0);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "browserbase_credit_seconds_balance FROM users WHERE id = $1",
    );
    expect(params).toEqual([1]);
  });

  it("returns the stored balance", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ browserbase_credit_seconds_balance: 1_800 }],
    });
    expect(await getBrowserbaseCreditBalanceSeconds(1)).toBe(1_800);
  });
});

describe("addBrowserbaseCreditBalanceSeconds", () => {
  it("adds to the user's balance", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await addBrowserbaseCreditBalanceSeconds(7, 1_800);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(
      /browserbase_credit_seconds_balance = browserbase_credit_seconds_balance \+ \$2/,
    );
    expect(params).toEqual([7, 1_800]);
  });

  it("is a no-op for zero or negative second counts", async () => {
    await addBrowserbaseCreditBalanceSeconds(7, 0);
    await addBrowserbaseCreditBalanceSeconds(7, -1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("creditBrowserbaseCreditPurchase", () => {
  it("records the purchase and credits the balance on first application", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ payment_intent_id: "pi_1" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await creditBrowserbaseCreditPurchase("pi_1", 7, 1_800);

    expect(result).toEqual({ credited: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = mockQuery.mock.calls[0];
    expect(insertSql).toContain("INSERT INTO browserbase_credit_purchases");
    expect(insertSql).toContain("ON CONFLICT (payment_intent_id) DO NOTHING");
    expect(insertSql).toContain("RETURNING payment_intent_id");
    expect(insertParams).toEqual(["pi_1", 7, 1_800]);
  });

  it("is a no-op -- does not double-credit -- when the same PaymentIntent id is applied a second time", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await creditBrowserbaseCreditPurchase("pi_1", 7, 1_800);
    expect(result).toEqual({ credited: false });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for zero or negative second counts, without touching the database", async () => {
    await creditBrowserbaseCreditPurchase("pi_1", 7, 0);
    await creditBrowserbaseCreditPurchase("pi_1", 7, -5);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("recordBrowserbaseSeconds", () => {
  it("upserts an addition to the period's counter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 300 }] });
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(90));
    const periodStart = new Date("2026-08-01T00:00:00Z");
    await recordBrowserbaseSeconds(1, 300, periodStart);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO browserbase_usage/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, period_start\)/);
    expect(sql).toMatch(/RETURNING seconds_used/);
    expect(params).toEqual([1, periodStart, 300]);
  });

  it("is a no-op for zero or negative second counts", async () => {
    await recordBrowserbaseSeconds(1, 0);
    await recordBrowserbaseSeconds(1, -5);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGetUserPlanLimits).not.toHaveBeenCalled();
  });

  it("does not touch credits when the session stays entirely within the free monthly allowance", async () => {
    // previousTotal 300 + this session's 300 = 600, well under 90 min (5400s).
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 600 }] });
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(90));
    await recordBrowserbaseSeconds(1, 300, new Date("2026-08-01T00:00:00Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("spends the whole session from credits once the period is already past the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(1)); // 60s limit
    // previousTotal (60) already at the limit -- the entire 90s this call
    // adds is overflow.
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 150 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // credit UPDATE
    await recordBrowserbaseSeconds(1, 90, new Date("2026-08-01T00:00:00Z"));
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(
      /browserbase_credit_seconds_balance = GREATEST\(browserbase_credit_seconds_balance - \$2, 0\)/,
    );
    expect(params).toEqual([1, 90]);
  });

  it("splits a single session across the period and credits when it straddles the limit boundary", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(1)); // 60s limit
    // previousTotal 40 + this session's 90 = 130 -- only 20s land inside the
    // free ceiling, the remaining 70s are overflow.
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 130 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordBrowserbaseSeconds(1, 90, new Date("2026-08-01T00:00:00Z"));
    const [, params] = mockQuery.mock.calls[1];
    expect(params).toEqual([1, 70]);
  });

  it("never touches credits when the plan has no ceiling (browserbaseMinutesPerMonth === -1)", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(-1));
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 999_999 }] });
    await recordBrowserbaseSeconds(1, 300, new Date("2026-08-01T00:00:00Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never touches credits when billing is disabled (getUserPlanLimits returns null)", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 999_999 }] });
    await recordBrowserbaseSeconds(1, 300, new Date("2026-08-01T00:00:00Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

/** getBrowserbaseCreditBalanceSeconds's SELECT is always the first
 *  pool.query call inside checkBrowserbaseQuota. */
function mockCreditBalanceQuery(balanceSeconds: number) {
  mockQuery.mockResolvedValueOnce({
    rows: [{ browserbase_credit_seconds_balance: balanceSeconds }],
  });
}

describe("checkBrowserbaseQuota", () => {
  it("is unlimited when billing is disabled (getUserPlanLimits returns null)", async () => {
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.limitMinutes).toBe(-1);
  });

  it("blocks with a clear message when the plan limit is 0 and there is no credit balance", async () => {
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(0));
    mockQuery.mockResolvedValueOnce({ rows: [] }); // seconds used
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/not available on your plan/i);
    expect(result.message).toMatch(/buy Browserbase minutes/i);
  });

  it("falls back to allowing a session via credits when the plan limit is 0 but a credit balance exists", async () => {
    mockCreditBalanceQuery(600);
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(0));
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.creditBalanceSeconds).toBe(600);
  });

  it("blocks once usage reaches the monthly cap and there is no credit balance", async () => {
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(1)); // 60s
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 60 }] });
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.usedSeconds).toBe(60);
    expect(result.message).toMatch(/upgrade your plan/i);
    expect(result.message).toMatch(/buy more minutes/i);
  });

  it("falls back to allowing a session via credits once the monthly cap is reached", async () => {
    mockCreditBalanceQuery(120);
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(1));
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 60 }] });
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.creditBalanceSeconds).toBe(120);
  });

  it("allows a session when usage is under the cap", async () => {
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce(planLimits(90));
    mockQuery.mockResolvedValueOnce({ rows: [{ seconds_used: 300 }] });
    const result = await checkBrowserbaseQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usedSeconds).toBe(300);
  });
});
