import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via the database pool in production;
// mocked here at the module boundary so it does not consume the mockQuery
// call sequence the free-trial assertions below depend on. The shipped
// registry default keeps the resolved trial window identical to the old
// hardcoded FREE_TRIAL_WINDOW_HOURS.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
  };
});

const mockResolveUserEndpoint = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  resolveUserEndpoint: (...args: unknown[]) => mockResolveUserEndpoint(...args),
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

/**
 * lib/billing/github-review-usage.ts imports resolveCurrentWindow directly
 * from lib/billing/ai-usage.ts (see that file's own doc comment on why
 * GitHub review resets on the exact same window as AI chat/verify/summary
 * instead of an independent monthly cadence). Mocking the whole module
 * here keeps this suite in control of windowStart/windowHours per test,
 * the same way it already controls getUserPlanLimits and
 * resolveUserEndpoint, and sidesteps needing the real
 * AI_USAGE_WINDOW_HOURS setting resolution.
 */
const mockResolveCurrentWindow = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  resolveCurrentWindow: (...args: unknown[]) =>
    mockResolveCurrentWindow(...args),
}));

const {
  hasOwnAiConfig,
  getGithubReviewTokensUsed,
  recordGithubReviewTokens,
  checkGithubReviewQuota,
  hasUsedFreeGithubReviewToday,
  claimFreeGithubReviewTrial,
  releaseFreeGithubReviewTrial,
  getGithubCreditBalance,
  addGithubCreditBalance,
  creditGithubCreditPurchase,
} = await import("@/lib/billing/github-review-usage");

const WINDOW_START = new Date("2026-03-15T05:00:00.000Z");

beforeEach(() => {
  mockQuery.mockReset();
  mockResolveUserEndpoint.mockReset();
  mockGetUserPlanLimits.mockReset();
  mockResolveCurrentWindow.mockReset();
  mockResolveCurrentWindow.mockResolvedValue({
    windowStart: WINDOW_START,
    windowHours: 5,
  });
});

describe("hasOwnAiConfig", () => {
  it("is true when resolveUserEndpoint finds a configured endpoint", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    expect(await hasOwnAiConfig(1)).toBe(true);
  });

  it("is false when resolveUserEndpoint returns null", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    expect(await hasOwnAiConfig(1)).toBe(false);
  });
});

describe("getGithubReviewTokensUsed", () => {
  it("returns 0 when no row exists for the window", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getGithubReviewTokensUsed(1, WINDOW_START)).toBe(0);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 4200 }] });
    expect(await getGithubReviewTokensUsed(1, WINDOW_START)).toBe(4200);
  });
});

describe("recordGithubReviewTokens", () => {
  it("upserts an addition to the window's counter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordGithubReviewTokens(1, 500, WINDOW_START);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO github_review_usage/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, window_start\)/);
    expect(params).toEqual([1, WINDOW_START, 500]);
    // A windowStart was passed explicitly, so it never needed to resolve
    // the current one.
    expect(mockResolveCurrentWindow).not.toHaveBeenCalled();
  });

  it("resolves the current window from AI_USAGE_WINDOW_HOURS when no windowStart is given", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordGithubReviewTokens(1, 500);
    expect(mockResolveCurrentWindow).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([1, WINDOW_START, 500]);
  });

  it("is a no-op for zero or negative token counts", async () => {
    await recordGithubReviewTokens(1, 0);
    await recordGithubReviewTokens(1, -5);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockResolveCurrentWindow).not.toHaveBeenCalled();
  });
});

describe("checkGithubReviewQuota", () => {
  it("bypasses the cap entirely when the user has their own AI key", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
    const result = await checkGithubReviewQuota(1);
    expect(result).toEqual({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
      windowStart: WINDOW_START,
      windowHours: 5,
      creditBalance: 0,
    });
    expect(mockGetUserPlanLimits).not.toHaveBeenCalled();
  });

  it("is unlimited when billing is disabled or the caller is staff (getUserPlanLimits returns null)", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usingOwnAi).toBe(false);
    expect(result.windowStart).toEqual(WINDOW_START);
    expect(result.windowHours).toBe(5);
  });

  it("allows the run via the hidden free trial when the plan limit is 0 and the trial hasn't been used today", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
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
      aiTokensPerWindow: 80_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getGithubReviewTokensUsed
    mockQuery.mockResolvedValueOnce({
      rows: [{ free_github_review_used_at: null }],
    }); // hasUsedFreeGithubReviewToday
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.isFreeTrial).toBe(true);
    expect(result.limitTokens).toBe(0);
    expect(result.windowStart).toEqual(WINDOW_START);
    expect(result.windowHours).toBe(5);
  });

  it("blocks with a clear message when the plan limit is 0 and today's free trial is already used", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
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
      aiTokensPerWindow: 80_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // getGithubReviewTokensUsed
    mockQuery.mockResolvedValueOnce({
      rows: [{ free_github_review_used_at: new Date() }],
    }); // hasUsedFreeGithubReviewToday -- used moments ago
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.isFreeTrial).toBeUndefined();
    expect(result.message).toMatch(/free github ai review/i);
  });

  it("blocks once usage reaches the window cap and there's no purchased credit balance", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 200_000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.usedTokens).toBe(200_000);
    expect(result.limitTokens).toBe(200_000);
    expect(result.message).toMatch(/upgrade your plan/i);
    expect(result.message).toMatch(/buy github review credits/i);
    expect(result.message).toContain("5-hour window");
  });

  it("allows the run past the window cap when a purchased credit balance covers it", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({
      rows: [{ github_credit_balance: 50_000 }],
    }); // getGithubCreditBalance
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 200_000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.creditBalance).toBe(50_000);
    expect(result.message).toBeUndefined();
  });

  it("allows the run when usage is under the cap", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 1000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usedTokens).toBe(1000);
  });

  it("resolves against the admin-configured window length, not a hardcoded 5", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockResolveCurrentWindow.mockResolvedValueOnce({
      windowStart: WINDOW_START,
      windowHours: 1,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ github_credit_balance: 0 }] }); // getGithubCreditBalance
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 200_000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.windowHours).toBe(1);
    expect(result.message).toContain("1-hour window");
  });
});

describe("recordGithubReviewTokens -- credit balance spend", () => {
  it("spends from the purchased credit balance only for the portion past the window cap", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 210_000 }] }); // UPSERT ... RETURNING, window already at 200k before this 10k-token call
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerWindow: 200_000,
      aiTokensPerWindow: 400_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // credit-balance UPDATE

    await recordGithubReviewTokens(1, 10_000, WINDOW_START);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [creditSql, creditParams] = mockQuery.mock.calls[1];
    expect(creditSql).toMatch(/UPDATE users SET github_credit_balance/);
    expect(creditParams).toEqual([1, 10_000]);
  });

  it("never spends credits for a 0-limit (free-trial-gated) plan", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 5_000 }] }); // UPSERT ... RETURNING
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
      aiTokensPerWindow: 80_000,
    });

    await recordGithubReviewTokens(1, 5_000, WINDOW_START);

    // Only the window UPSERT ran -- no credit-balance UPDATE, even though
    // this "call" used real tokens, since a 0-limit plan's usage is always
    // trial-covered, never credit-covered.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never spends credits when billing is disabled (unlimited)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 5_000 }] });
    mockGetUserPlanLimits.mockResolvedValueOnce(null);

    await recordGithubReviewTokens(1, 5_000, WINDOW_START);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("hasUsedFreeGithubReviewToday", () => {
  it("is false when the trial has never been used", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ free_github_review_used_at: null }],
    });
    expect(await hasUsedFreeGithubReviewToday(1)).toBe(false);
  });

  it("is false when no user row is found", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await hasUsedFreeGithubReviewToday(1)).toBe(false);
  });

  it("is true when the trial was used less than 24 hours ago", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { free_github_review_used_at: new Date(Date.now() - 60 * 60 * 1000) },
      ],
    });
    expect(await hasUsedFreeGithubReviewToday(1)).toBe(true);
  });

  it("is false once 24 hours have passed since the last use", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          free_github_review_used_at: new Date(
            Date.now() - 25 * 60 * 60 * 1000,
          ),
        },
      ],
    });
    expect(await hasUsedFreeGithubReviewToday(1)).toBe(false);
  });
});

describe("claimFreeGithubReviewTrial", () => {
  it("claims the slot (returns true) when the UPDATE matches a row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 });

    const claimed = await claimFreeGithubReviewTrial(7);

    expect(claimed).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(
      /UPDATE users SET free_github_review_used_at = NOW\(\)/,
    );
    expect(sql).toMatch(/RETURNING id/);
    expect(params[0]).toBe(7);
  });

  it("loses the race (returns false) when the UPDATE matches no row -- e.g. a concurrent request already claimed it", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const claimed = await claimFreeGithubReviewTrial(7);

    expect(claimed).toBe(false);
  });

  it("treats a null rowCount as zero rows claimed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: null });

    expect(await claimFreeGithubReviewTrial(7)).toBe(false);
  });
});

describe("releaseFreeGithubReviewTrial", () => {
  it("resets free_github_review_used_at to NULL for the given user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await releaseFreeGithubReviewTrial(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE users SET free_github_review_used_at = NULL/);
    expect(params).toEqual([7]);
  });
});

describe("getGithubCreditBalance", () => {
  it("returns 0 when the user row has no balance set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getGithubCreditBalance(1)).toBe(0);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("github_credit_balance FROM users WHERE id = $1");
    expect(params).toEqual([1]);
  });

  it("returns the stored balance", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ github_credit_balance: 4_200 }],
    });
    expect(await getGithubCreditBalance(1)).toBe(4_200);
  });
});

describe("addGithubCreditBalance", () => {
  it("adds to the user's balance", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await addGithubCreditBalance(7, 500_000);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/github_credit_balance = github_credit_balance \+ \$2/);
    expect(params).toEqual([7, 500_000]);
  });

  it("is a no-op for zero or negative token counts", async () => {
    await addGithubCreditBalance(7, 0);
    await addGithubCreditBalance(7, -1);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("creditGithubCreditPurchase", () => {
  it("records the purchase and credits the balance on first application", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ payment_intent_id: "pi_1" }],
    }); // github_credit_purchases INSERT succeeds
    mockQuery.mockResolvedValueOnce({ rows: [] }); // addGithubCreditBalance UPDATE

    const result = await creditGithubCreditPurchase("pi_1", 7, 1_000_000);

    expect(result).toEqual({ credited: true });
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = mockQuery.mock.calls[0];
    expect(insertSql).toContain("INSERT INTO github_credit_purchases");
    expect(insertSql).toContain("ON CONFLICT (payment_intent_id) DO NOTHING");
    expect(insertParams).toEqual(["pi_1", 7, 1_000_000]);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(
      /github_credit_balance = github_credit_balance \+ \$2/,
    );
    expect(updateParams).toEqual([7, 1_000_000]);
  });

  it("is a no-op -- does not double-credit -- when the same PaymentIntent id is applied a second time", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // INSERT conflicts

    const result = await creditGithubCreditPurchase("pi_1", 7, 1_000_000);

    expect(result).toEqual({ credited: false });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
