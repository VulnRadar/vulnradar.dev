import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", () => ({
  getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
}));

const { checkConcurrentScanLimit } =
  await import("@/lib/rate-limiting/concurrent-scans");

function planLimits(concurrentScans: number) {
  return {
    dailyScans: 100,
    apiKeys: 1,
    apiRequestsPerDay: 100,
    teams: 0,
    teamMembers: 0,
    webhooks: 0,
    scheduledScans: 0,
    bulkScanUrls: 0,
    githubReviewTokensPerWindow: 0,
    aiTokensPerWindow: 0,
    browserbaseMinutesPerMonth: 0,
    concurrentScans,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetUserPlanLimits.mockReset();
});

describe("checkConcurrentScanLimit", () => {
  it("is unlimited without querying the database when billing is disabled (getUserPlanLimits returns null)", async () => {
    mockGetUserPlanLimits.mockResolvedValue(null);
    const result = await checkConcurrentScanLimit(1);
    expect(result).toEqual({ allowed: true, current: 0, limit: -1 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is unlimited without querying the database when the plan's own limit is -1", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(-1));
    const result = await checkConcurrentScanLimit(1);
    expect(result).toEqual({ allowed: true, current: 0, limit: -1 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows the request when current in-flight scans are under the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result).toEqual({ allowed: true, current: 1, limit: 3 });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("status IN ('pending', 'running')");
    expect(params).toEqual([7]);
  });

  it("blocks with a clear message once at the limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(3);
    expect(result.limit).toBe(3);
    expect(result.message).toMatch(/already have 3 scan\(s\) running/i);
  });

  it("blocks when already over the limit (e.g. the limit was lowered by an admin after scans started)", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(2));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
  });

  it("treats a missing count row as zero in-flight scans", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(3));
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await checkConcurrentScanLimit(7);
    expect(result).toEqual({ allowed: true, current: 0, limit: 3 });
  });

  it("blocks outright when the plan's limit is 0", async () => {
    mockGetUserPlanLimits.mockResolvedValue(planLimits(0));
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    const result = await checkConcurrentScanLimit(7);
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });
});
