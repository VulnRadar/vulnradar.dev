import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for lib/billing/plan-limits.ts's plan-tier comparison helpers,
 * added for the hourly/6-hourly scheduled-scan frequency gate
 * (FREQUENCIES.minPlan in lib/scanner/schedule-timing.ts). getUserPlan and
 * getSetting are mocked at the module boundary; planMeetsMinimum is pure
 * and tested directly against catalog.ts's real PLANS ordering.
 */

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const mockGetSetting = vi.fn();
const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const {
  planMeetsMinimum,
  userMeetsScheduleFrequency,
  withinPlanLimit,
  planLimitMessage,
} = await import("@/lib/billing/plan-limits");

beforeEach(() => {
  mockGetUserPlan.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true); // BILLING_ENABLED default
  mockGetSettings.mockReset();
});

describe("planMeetsMinimum", () => {
  it("ranks free < core_supporter < pro_supporter < elite_supporter", () => {
    expect(planMeetsMinimum("free", "core_supporter")).toBe(false);
    expect(planMeetsMinimum("core_supporter", "pro_supporter")).toBe(false);
    expect(planMeetsMinimum("pro_supporter", "elite_supporter")).toBe(false);
    expect(planMeetsMinimum("elite_supporter", "elite_supporter")).toBe(true);
  });

  it("a higher plan meets a lower minimum", () => {
    expect(planMeetsMinimum("elite_supporter", "pro_supporter")).toBe(true);
    expect(planMeetsMinimum("pro_supporter", "free")).toBe(true);
  });

  it("an unrecognized plan id never meets any real minimum", () => {
    expect(planMeetsMinimum("some_stale_plan", "free")).toBe(false);
  });
});

describe("userMeetsScheduleFrequency", () => {
  it("always passes when minPlan is undefined (daily/weekly/monthly, no extra gate)", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    expect(await userMeetsScheduleFrequency(1, undefined)).toBe(true);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
  });

  it("bypasses the gate entirely when BILLING_ENABLED is false (self-hosted)", async () => {
    mockGetSetting.mockResolvedValue(false);
    expect(await userMeetsScheduleFrequency(1, "elite_supporter")).toBe(true);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
  });

  it("resolves a staff account to the Pro Supporter plan for the frequency gate, not an automatic pass", async () => {
    mockGetUserPlan.mockResolvedValue("staff");
    expect(await userMeetsScheduleFrequency(1, "pro_supporter")).toBe(true);
    expect(await userMeetsScheduleFrequency(1, "elite_supporter")).toBe(false);
  });

  it("rejects a free-plan user asking for an elite-gated frequency", async () => {
    mockGetUserPlan.mockResolvedValue("free");
    expect(await userMeetsScheduleFrequency(1, "elite_supporter")).toBe(false);
  });

  it("rejects a pro-plan user asking for an elite-gated frequency (hourly)", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter");
    expect(await userMeetsScheduleFrequency(1, "elite_supporter")).toBe(false);
  });

  it("accepts a pro-plan user asking for a pro-gated frequency (6hourly)", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter");
    expect(await userMeetsScheduleFrequency(1, "pro_supporter")).toBe(true);
  });

  it("accepts an elite-plan user asking for any gated frequency", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    expect(await userMeetsScheduleFrequency(1, "elite_supporter")).toBe(true);
    expect(await userMeetsScheduleFrequency(1, "pro_supporter")).toBe(true);
  });
});

describe("withinPlanLimit / planLimitMessage (pre-existing, sanity-checked here alongside the new helpers)", () => {
  it("-1 always means unlimited", () => {
    expect(withinPlanLimit(999999, -1)).toBe(true);
  });

  it("0 means the plan does not include the resource at all", () => {
    expect(withinPlanLimit(0, 0)).toBe(false);
    expect(planLimitMessage("Scheduled scans", 0)).toContain(
      "not available on your plan",
    );
  });

  it("a positive limit compares strictly less-than", () => {
    expect(withinPlanLimit(4, 5)).toBe(true);
    expect(withinPlanLimit(5, 5)).toBe(false);
    expect(planLimitMessage("Scheduled scans", 5)).toContain("up to 5");
  });
});
