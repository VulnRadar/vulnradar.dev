import { describe, it, expect, beforeEach, vi } from "vitest";

const mockDailyCount = vi.fn();
const mockDailyLimit = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getDailyRequestCount: (...a: unknown[]) => mockDailyCount(...a),
  getDailyLimit: (...a: unknown[]) => mockDailyLimit(...a),
}));

const mockPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...a: unknown[]) => mockPlanLimits(...a),
}));

const mockWindow = vi.fn();
const mockAiUsed = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  resolveCurrentWindow: (...a: unknown[]) => mockWindow(...a),
  getAiTokensUsed: (...a: unknown[]) => mockAiUsed(...a),
}));

const mockGithubUsed = vi.fn();
const mockOwnAi = vi.fn();
vi.mock("@/lib/billing/github-review-usage", () => ({
  getGithubReviewTokensUsed: (...a: unknown[]) => mockGithubUsed(...a),
  hasOwnAiConfig: (...a: unknown[]) => mockOwnAi(...a),
}));

const { getUserUsage } = await import("@/lib/admin/user-usage");

const WINDOW_START = new Date("2026-10-01T00:00:00.000Z");

beforeEach(() => {
  for (const m of [
    mockDailyCount,
    mockDailyLimit,
    mockPlanLimits,
    mockWindow,
    mockAiUsed,
    mockGithubUsed,
    mockOwnAi,
  ]) {
    m.mockReset();
  }
  mockWindow.mockResolvedValue({ windowStart: WINDOW_START, windowHours: 5 });
  mockDailyCount.mockResolvedValue(12);
  mockDailyLimit.mockResolvedValue(25);
  mockPlanLimits.mockResolvedValue({
    aiTokensPerWindow: 50_000,
    githubReviewTokensPerWindow: 200_000,
  });
  mockAiUsed.mockResolvedValue(41_000);
  mockGithubUsed.mockResolvedValue(0);
  mockOwnAi.mockResolvedValue(false);
});

describe("getUserUsage", () => {
  it("reads each figure from the helper enforcement uses, for this user", async () => {
    const usage = await getUserUsage(7);
    expect(mockDailyCount).toHaveBeenCalledWith(7);
    expect(mockDailyLimit).toHaveBeenCalledWith(7);
    expect(mockPlanLimits).toHaveBeenCalledWith(7);
    expect(mockAiUsed).toHaveBeenCalledWith(7, WINDOW_START);
    expect(mockGithubUsed).toHaveBeenCalledWith(7, WINDOW_START);
    expect(usage).toEqual({
      scans: { used: 12, limit: 25 },
      ai: {
        used: 41_000,
        limit: 50_000,
        // Five hours after the window opened.
        windowEndsAt: "2026-10-01T05:00:00.000Z",
        usingOwnKey: false,
      },
      githubReview: {
        used: 0,
        limit: 200_000,
        windowEndsAt: "2026-10-01T05:00:00.000Z",
      },
    });
  });

  // getDailyLimit returns Infinity for unlimited, and Infinity is not JSON.
  it("reports an unlimited daily cap as null, not Infinity", async () => {
    mockDailyLimit.mockResolvedValue(Infinity);
    const usage = await getUserUsage(7);
    expect(usage.scans.limit).toBeNull();
    expect(JSON.parse(JSON.stringify(usage)).scans.limit).toBeNull();
  });

  it("treats billing being off (no plan limits) as uncapped", async () => {
    mockPlanLimits.mockResolvedValue(null);
    const usage = await getUserUsage(7);
    expect(usage.ai.limit).toBeNull();
    expect(usage.githubReview.limit).toBeNull();
  });

  it("treats the plan's own -1 as uncapped and keeps a cap of 0 as 0", async () => {
    mockPlanLimits.mockResolvedValue({
      aiTokensPerWindow: -1,
      githubReviewTokensPerWindow: 0,
    });
    const usage = await getUserUsage(7);
    expect(usage.ai.limit).toBeNull();
    // 0 means the plan does not include it, which is not the same as no cap.
    expect(usage.githubReview.limit).toBe(0);
  });

  it("says when the user brings their own AI key", async () => {
    mockOwnAi.mockResolvedValue(true);
    expect((await getUserUsage(7)).ai.usingOwnKey).toBe(true);
  });

  it("lets a read failure through to the caller, which decides what to do", async () => {
    mockDailyCount.mockRejectedValue(new Error("db down"));
    await expect(getUserUsage(7)).rejects.toThrow("db down");
  });
});
