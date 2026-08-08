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

const {
  currentYearMonth,
  hasOwnAiConfig,
  getGithubReviewTokensUsed,
  recordGithubReviewTokens,
  checkGithubReviewQuota,
} = await import("@/lib/billing/github-review-usage");

beforeEach(() => {
  mockQuery.mockReset();
  mockResolveUserEndpoint.mockReset();
  mockGetUserPlanLimits.mockReset();
});

describe("currentYearMonth", () => {
  it("formats as UTC YYYY-MM", () => {
    expect(currentYearMonth(new Date("2026-03-15T23:59:00Z"))).toBe("2026-03");
    expect(currentYearMonth(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
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
  it("returns 0 when no row exists for the month", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getGithubReviewTokensUsed(1, "2026-03")).toBe(0);
  });

  it("returns the stored value", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 4200 }] });
    expect(await getGithubReviewTokensUsed(1, "2026-03")).toBe(4200);
  });
});

describe("recordGithubReviewTokens", () => {
  it("upserts an addition to the monthly counter", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordGithubReviewTokens(1, 500, "2026-03");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO github_review_usage/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, year_month\)/);
    expect(params).toEqual([1, "2026-03", 500]);
  });

  it("is a no-op for zero or negative token counts", async () => {
    await recordGithubReviewTokens(1, 0);
    await recordGithubReviewTokens(1, -5);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("checkGithubReviewQuota", () => {
  it("bypasses the cap entirely when the user has their own AI key", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-x",
      model: "gpt-4o-mini",
    });
    const result = await checkGithubReviewQuota(1);
    expect(result).toEqual({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });
    expect(mockGetUserPlanLimits).not.toHaveBeenCalled();
  });

  it("is unlimited when billing is disabled or the caller is staff (getUserPlanLimits returns null)", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockGetUserPlanLimits.mockResolvedValueOnce(null);
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usingOwnAi).toBe(false);
  });

  it("blocks with a clear message when the plan limit is 0", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 25,
      apiKeys: 1,
      apiRequestsPerDay: 25,
      teams: 0,
      teamMembers: 0,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
      githubReviewTokensPerMonth: 0,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/not available on your plan/i);
  });

  it("blocks once usage reaches the monthly cap", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerMonth: 200_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 200_000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(false);
    expect(result.usedTokens).toBe(200_000);
    expect(result.limitTokens).toBe(200_000);
    expect(result.message).toMatch(/upgrade your plan/i);
  });

  it("allows the run when usage is under the cap", async () => {
    mockResolveUserEndpoint.mockResolvedValueOnce(null);
    mockGetUserPlanLimits.mockResolvedValueOnce({
      dailyScans: 100,
      apiKeys: 3,
      apiRequestsPerDay: 100,
      teams: 0,
      teamMembers: 0,
      webhooks: 1,
      scheduledScans: 0,
      bulkScanUrls: 10,
      githubReviewTokensPerMonth: 200_000,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ tokens_used: 1000 }] });
    const result = await checkGithubReviewQuota(1);
    expect(result.allowed).toBe(true);
    expect(result.usedTokens).toBe(1000);
  });
});
