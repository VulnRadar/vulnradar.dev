import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockResolveUserEndpoint = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  resolveUserEndpoint: (...args: unknown[]) => mockResolveUserEndpoint(...args),
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const {
  currentWindowStart,
  getAiTokensUsed,
  getAiCreditBalance,
  addAiCreditBalance,
  creditAiCreditPurchase,
  recordAiTokens,
  checkAiUsageQuota,
} = await import("@/lib/billing/ai-usage");

beforeEach(() => {
  mockQuery.mockReset();
  mockResolveUserEndpoint.mockReset();
  mockGetUserPlanLimits.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(5); // AI_USAGE_WINDOW_HOURS default
});

describe("currentWindowStart", () => {
  it("floors a UTC timestamp to the start of its fixed-length bucket, anchored to the Unix epoch", () => {
    // Anchored to 00:00:00 UTC 1 Jan 1970, not the local calendar day --
    // 5 doesn't evenly divide 24, so these boundaries do NOT land on a
    // clean multiple-of-5 UTC clock time every day (see the next test for
    // a window length that DOES evenly divide a day).
    expect(currentWindowStart(new Date("2026-03-15T07:59:00Z"), 5)).toEqual(
      new Date("2026-03-15T07:00:00.000Z"),
    );
    expect(currentWindowStart(new Date("2026-03-15T00:00:00Z"), 5)).toEqual(
      new Date("2026-03-14T21:00:00.000Z"),
    );
    expect(currentWindowStart(new Date("2026-03-15T23:59:59Z"), 5)).toEqual(
      new Date("2026-03-15T22:00:00.000Z"),
    );
  });

  it("two timestamps in the same fixed slice resolve to the identical window start", () => {
    const a = currentWindowStart(new Date("2026-03-15T07:00:00.000Z"), 5);
    const b = currentWindowStart(new Date("2026-03-15T11:59:59.999Z"), 5);
    expect(a).toEqual(b);
  });

  it("a window length that evenly divides 24 (e.g. 1 or 24) resets at the same UTC clock time every day", () => {
    expect(currentWindowStart(new Date("2026-03-15T13:30:00Z"), 1)).toEqual(
      new Date("2026-03-15T13:00:00.000Z"),
    );
    expect(currentWindowStart(new Date("2026-03-15T13:30:00Z"), 24)).toEqual(
      new Date("2026-03-15T00:00:00.000Z"),
    );
    expect(currentWindowStart(new Date("2026-03-16T13:30:00Z"), 24)).toEqual(
      new Date("2026-03-16T00:00:00.000Z"),
    );
  });

  it("defaults to a 5-hour window when no windowHours is given", () => {
    expect(currentWindowStart(new Date("2026-03-15T07:59:00Z"))).toEqual(
      new Date("2026-03-15T07:00:00.000Z"),
    );
  });
});

describe("getAiTokensUsed", () => {
  it("returns 0 when no row exists for the window", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const windowStart = new Date("2026-03-15T05:00:00.000Z");
    expect(await getAiTokensUsed(1, windowStart)).toBe(0);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 4200 }] });
    const windowStart = new Date("2026-03-15T05:00:00.000Z");
    expect(await getAiTokensUsed(1, windowStart)).toBe(4200);
  });
});

describe("getAiCreditBalance", () => {
  it("returns 0 when the user row has no balance set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getAiCreditBalance(1)).toBe(0);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("ai_credit_balance FROM users WHERE id = $1");
    expect(params).toEqual([1]);
  });

  it("returns the stored balance", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_credit_balance: 4_200 }] });
    expect(await getAiCreditBalance(1)).toBe(4_200);
  });
});

describe("addAiCreditBalance", () => {
  it("adds to the user's balance", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await addAiCreditBalance(7, 500_000);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ai_credit_balance = ai_credit_balance \+ \$2/);
    expect(params).toEqual([7, 500_000]);
  });

  it("is a no-op for zero or negative token counts", async () => {
    await addAiCreditBalance(7, 0);
    await addAiCreditBalance(7, -1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("creditAiCreditPurchase", () => {
  it("records the purchase and credits the balance in one atomic statement", async () => {
    // The guard-insert and the balance increment are now a single CTE, so a
    // crash can't strand the purchase between them. One query, RETURNING the
    // updated user row when the insert won.
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });

    const result = await creditAiCreditPurchase("pi_1", 7, 1_000_000);

    expect(result).toEqual({ credited: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO ai_credit_purchases");
    expect(sql).toContain("ON CONFLICT (payment_intent_id) DO NOTHING");
    expect(sql).toMatch(/ai_credit_balance = ai_credit_balance \+/);
    expect(params).toEqual(["pi_1", 7, 1_000_000]);
  });

  it("is a no-op -- does not double-credit -- when the same PaymentIntent id is applied a second time", async () => {
    // This is the whole point of the table: two independent callers
    // (confirmAiCreditPurchase and the payment_intent.succeeded webhook)
    // can both race to credit the exact same successful payment. Only the
    // first INSERT for a given payment_intent_id should ever succeed.
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // INSERT conflicts

    const result = await creditAiCreditPurchase("pi_1", 7, 1_000_000);

    expect(result).toEqual({ credited: false });
    // Only the INSERT attempt ran -- addAiCreditBalance was never reached.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("credits two DIFFERENT purchases (different PaymentIntent ids) independently", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 7 }] });

    const first = await creditAiCreditPurchase("pi_a", 7, 1_000_000);
    const second = await creditAiCreditPurchase("pi_b", 7, 3_000_000);

    expect(first).toEqual({ credited: true });
    expect(second).toEqual({ credited: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("is a no-op for zero or negative token counts, without touching the database", async () => {
    await creditAiCreditPurchase("pi_1", 7, 0);
    await creditAiCreditPurchase("pi_1", 7, -5);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("recordAiTokens", () => {
  it("upserts an addition to the window's counter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const windowStart = new Date("2026-03-15T05:00:00.000Z");
    await recordAiTokens(1, 500, windowStart);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO ai_usage/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, window_start\)/);
    expect(sql).toMatch(/RETURNING tokens_used/);
    expect(params).toEqual([1, windowStart, 500]);
  });

  it("is a no-op for zero or negative token counts", async () => {
    await recordAiTokens(1, 0);
    await recordAiTokens(1, -5);
    expect(mockQuery).not.toHaveBeenCalled();
    // Never even resolves the current window when there's nothing to record.
    expect(mockGetSetting).not.toHaveBeenCalled();
  });

  it("resolves the current window from AI_USAGE_WINDOW_HOURS when no windowStart is given", async () => {
    mockGetSetting.mockResolvedValueOnce(1);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordAiTokens(1, 500);
    expect(mockGetSetting).toHaveBeenCalledWith("AI_USAGE_WINDOW_HOURS");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not touch credits when the call stays entirely within the free allowance", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 600 }] }); // previousTotal 100 + 500
    await recordAiTokens(1, 500, new Date("2026-03-15T05:00:00.000Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("spends the whole call from credits once the window is already past the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    // previousTotal (20,000) already at the limit -- the entire 500 this
    // call adds is overflow.
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 20_500 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // credit UPDATE
    await recordAiTokens(1, 500, new Date("2026-03-15T05:00:00.000Z"));
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(
      /ai_credit_balance = GREATEST\(ai_credit_balance - \$2, 0\)/,
    );
    expect(params).toEqual([1, 500]);
  });

  it("splits a single call across the window and credits when it straddles the limit boundary", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    // previousTotal 19,800 + this call's 500 = 20,300 -- only 200 tokens
    // land inside the free ceiling, the remaining 300 are overflow.
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 20_300 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // credit UPDATE
    await recordAiTokens(1, 500, new Date("2026-03-15T05:00:00.000Z"));
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, params] = mockQuery.mock.calls[1];
    expect(params).toEqual([1, 300]);
  });

  it("never touches credits when the plan has no ceiling (aiTokensPerWindow === -1)", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: -1,
      apiKeys: -1,
      apiRequestsPerDay: -1,
      teams: -1,
      teamMembers: -1,
      webhooks: -1,
      scheduledScans: -1,
      bulkScanUrls: -1,
      githubReviewTokensPerWindow: 5_000_000,
      aiTokensPerWindow: -1,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 999_999 }] });
    await recordAiTokens(1, 500, new Date("2026-03-15T05:00:00.000Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never touches credits when billing is disabled (getUserPlanLimits returns null)", async () => {
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 999_999 }] });
    await recordAiTokens(1, 500, new Date("2026-03-15T05:00:00.000Z"));
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

/** getAiCreditBalance's SELECT is always the first pool.query call inside
 *  checkAiUsageQuota, resolved unconditionally before the own-AI-key /
 *  billing-disabled branches even run. */
function mockCreditBalanceQuery(balance: number) {
  mockQuery.mockResolvedValueOnce({ rows: [{ ai_credit_balance: balance }] });
}

describe("checkAiUsageQuota", () => {
  it("bypasses the cap entirely when the user has their own AI key", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    mockCreditBalanceQuery(0);
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usingOwnAi).toBe(true);
    expect(result.usedTokens).toBe(0);
    expect(result.limitTokens).toBe(-1);
    expect(result.creditBalance).toBe(0);
    expect(mockGetUserPlanLimits).not.toHaveBeenCalled();
  });

  it("still resolves the real credit balance on the own-AI-key bypass path, for accurate display even when it isn't needed to allow the call", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    mockCreditBalanceQuery(12_345);
    const result = await checkAiUsageQuota(1);
    expect(result.creditBalance).toBe(12_345);
  });

  it("is unlimited when billing is disabled or the caller is staff (getUserPlanLimits returns null)", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usingOwnAi).toBe(false);
    expect(result.limitTokens).toBe(-1);
    expect(result.creditBalance).toBe(0);
  });

  it("blocks with a clear message when the plan limit is 0 and there is no credit balance", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce({
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
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/not available on your plan/i);
    expect(result.message).toMatch(/buy AI credits/i);
  });

  it("falls back to allowing the call via credits when the plan limit is 0 but a credit balance exists", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(500_000);
    mockGetUserPlanLimits.mockResolvedValueOnce({
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
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.creditBalance).toBe(500_000);
    expect(result.message).toBeUndefined();
  });

  it("blocks once usage reaches the window cap and there is no credit balance", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 20_000 }] });
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.usedTokens).toBe(20_000);
    expect(result.limitTokens).toBe(20_000);
    expect(result.creditBalance).toBe(0);
    expect(result.message).toMatch(/upgrade your plan/i);
    expect(result.message).toMatch(/buy AI credits/i);
    expect(result.message).toContain("5-hour window");
  });

  it("falls back to allowing the call via credits once the window cap is reached, when a credit balance exists", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(1_000);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 20_000 }] });
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usedTokens).toBe(20_000);
    expect(result.creditBalance).toBe(1_000);
    expect(result.message).toBeUndefined();
  });

  it("allows the call when usage is under the cap", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 1000 }] });
    const result = await checkAiUsageQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usedTokens).toBe(1000);
    expect(result.creditBalance).toBe(0);
  });

  it("resolves against the admin-configured window length, not a hardcoded 5", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockGetSetting.mockReset();
    mockGetSetting.mockResolvedValue(1); // AI_USAGE_WINDOW_HOURS overridden to 1
    mockCreditBalanceQuery(0);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerWindow: 0,
      aiTokensPerWindow: 20_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 20_000 }] });
    const result = await checkAiUsageQuota(1);
    expect(result.windowHours).toBe(1);
    expect(result.message).toContain("1-hour window");
  });
});
