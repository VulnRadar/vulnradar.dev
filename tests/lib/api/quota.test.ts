import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPeek = vi.fn();
const mockCheck = vi.fn();
const mockCan = vi.fn();
const mockIncrement = vi.fn();

vi.mock("@/lib/api/api-keys", () => ({
  UNLIMITED_API_KEY_DAILY_LIMIT: 999999,
  peekRateLimit: (...args: unknown[]) => mockPeek(...args),
  checkRateLimit: (...args: unknown[]) => mockCheck(...args),
}));
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCan(...args),
  incrementDailyCountCapped: (...args: unknown[]) => mockIncrement(...args),
}));

const { buildQuotaBlock } = await import("@/lib/api/quota");

const MIDNIGHT = "2026-11-09T00:00:00.000Z";
const ROLLING = "2026-11-09T06:12:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockResolvedValue({
    allowed: true,
    used: 12,
    limit: 150,
    remaining: 138,
    resetsAt: MIDNIGHT,
  });
  mockPeek.mockResolvedValue({
    allowed: true,
    used: 40,
    limit: 5000,
    remaining: 4960,
    resetsAt: ROLLING,
  });
});

describe("buildQuotaBlock", () => {
  it("reports both budgets with their own reset times", async () => {
    expect(await buildQuotaBlock(9, { keyId: 3, dailyLimit: 5000 })).toEqual({
      scans: { limit: 150, used: 12, remaining: 138, resetsAt: MIDNIGHT },
      requests: { limit: 5000, used: 40, remaining: 4960, resetsAt: ROLLING },
    });
    expect(mockCan).toHaveBeenCalledWith(9);
    expect(mockPeek).toHaveBeenCalledWith(3, 5000);
  });

  it("has no request budget without a key", async () => {
    expect((await buildQuotaBlock(9)).requests).toBeNull();
    expect((await buildQuotaBlock(9, null)).requests).toBeNull();
    expect(mockPeek).not.toHaveBeenCalled();
  });

  it("writes -1 as null", async () => {
    mockCan.mockResolvedValue({
      allowed: true,
      used: 4,
      limit: -1,
      remaining: -1,
      resetsAt: MIDNIGHT,
    });
    const { scans } = await buildQuotaBlock(9);
    expect(scans).toEqual({
      limit: null,
      used: 4,
      remaining: null,
      resetsAt: MIDNIGHT,
    });
  });

  it("writes the 999999 stand-in as null", async () => {
    mockPeek.mockResolvedValue({
      allowed: true,
      used: 7,
      limit: 999999,
      remaining: 999992,
      resetsAt: ROLLING,
    });
    const { requests } = await buildQuotaBlock(9, {
      keyId: 3,
      dailyLimit: 999999,
    });
    expect(requests).toEqual({
      limit: null,
      used: 7,
      remaining: null,
      resetsAt: ROLLING,
    });
  });

  it("keeps a real limit of zero", async () => {
    mockCan.mockResolvedValue({
      allowed: false,
      used: 0,
      limit: 0,
      remaining: 0,
      resetsAt: MIDNIGHT,
    });
    const { scans } = await buildQuotaBlock(9);
    expect(scans.limit).toBe(0);
    expect(scans.remaining).toBe(0);
  });

  it("spends nothing", async () => {
    await buildQuotaBlock(9, { keyId: 3, dailyLimit: 5000 });
    expect(mockCheck).not.toHaveBeenCalled();
    expect(mockIncrement).not.toHaveBeenCalled();
  });
});
