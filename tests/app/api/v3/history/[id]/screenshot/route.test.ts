/**
 * Route-level tests for POST /api/v3/history/[id]/screenshot, focused on the
 * premium plan gate (BUG 3). The real requireRefreshPlan -> userMeetsMinimumPlan
 * chain runs; only its two inputs (getSetting for BILLING_ENABLED and
 * getUserPlan) are mocked. The capture itself (captureAndStoreScreenshot, which
 * is a headless-browser + metering boundary) is mocked outright.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const mockResolveScanRow = vi.fn();
vi.mock("@/lib/history/resolve-scan", () => ({
  resolveScanRow: (...a: unknown[]) => mockResolveScanRow(...a),
}));

const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...a: unknown[]) => mockGetSetting(...a),
  getSettings: () => Promise.resolve({}),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...a: unknown[]) => mockGetUserPlan(...a),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...a: unknown[]) => mockCheckRateLimit(...a),
  };
});

const mockCapture = vi.fn();
vi.mock("@/lib/scanner/page-screenshot", () => ({
  captureAndStoreScreenshot: (...a: unknown[]) => mockCapture(...a),
}));

const mockBrowserQuota = vi.fn();
vi.mock("@/lib/billing/browserbase-usage", () => ({
  checkBrowserbaseQuota: (...a: unknown[]) => mockBrowserQuota(...a),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));

const { POST } = await import("@/app/api/v3/history/[id]/screenshot/route");

function req() {
  return new NextRequest("http://localhost/api/v3/history/10/screenshot", {
    method: "POST",
  });
}
function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

const fakeShot = {
  width: 1280,
  height: 720,
  capturedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  mockGetSession.mockReset().mockResolvedValue({ userId: 42 });
  mockResolveScanRow
    .mockReset()
    .mockResolvedValue({ id: 10, user_id: 42, url: "https://example.com" });
  mockGetSetting.mockReset().mockResolvedValue(true); // BILLING_ENABLED
  mockGetUserPlan.mockReset().mockResolvedValue("pro_supporter"); // paid
  mockCheckRateLimit
    .mockReset()
    .mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
  mockCapture.mockReset().mockResolvedValue(fakeShot);
  mockBrowserQuota.mockReset().mockResolvedValue({
    allowed: true,
    usedSeconds: 0,
    limitMinutes: 60,
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    creditBalanceSeconds: 0,
  });
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("POST /api/v3/history/[id]/screenshot - premium plan gate (BUG 3)", () => {
  it("402s a free user and never runs the capture", async () => {
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.statusCode).toBe("UPGRADE_REQUIRED");
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("402s a plan below Pro (core_supporter)", async () => {
    mockGetUserPlan.mockResolvedValue("core_supporter");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("allows a paid (Pro) user and persists the fresh reference", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.screenshot).toEqual(fakeShot);
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("result_meta = COALESCE"),
    );
    expect(update).toBeDefined();
    expect(JSON.parse(update![1][0])).toEqual({ screenshot: fakeShot });
  });

  it("allows everyone when billing is disabled (self-host), even a free plan", async () => {
    mockGetSetting.mockResolvedValue(false); // BILLING_ENABLED off
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockCapture).toHaveBeenCalled();
  });

  it("502s a paid user when the capture cannot run", async () => {
    mockCapture.mockResolvedValue(null);

    const res = await POST(req(), params());

    expect(res.status).toBe(502);
    // Nothing persisted when the capture failed.
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("result_meta = COALESCE"),
    );
    expect(update).toBeUndefined();
  });
});

/**
 * Ownership is the gate that stops one user spending another's live-browser
 * minutes, and it is the one the panel's client-side check (a scan id passed
 * only on the owner's own surfaces) can never enforce on its own.
 */
describe("POST /api/v3/history/[id]/screenshot - ownership", () => {
  it("401s an unauthenticated caller before touching the plan or the meter", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(req(), params());

    expect(res.status).toBe(401);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
    expect(mockBrowserQuota).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("404s a scan owned by someone else and never captures on their account", async () => {
    mockResolveScanRow.mockResolvedValue({
      id: 10,
      user_id: 999,
      url: "https://example.com",
    });

    const res = await POST(req(), params());

    // 404, not 403: the same answer a nonexistent scan gets, so a stranger
    // cannot enumerate which scan ids exist.
    expect(res.status).toBe(404);
    expect(mockBrowserQuota).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("result_meta = COALESCE"),
    );
    expect(update).toBeUndefined();
  });

  it("404s a scan that does not exist", async () => {
    mockResolveScanRow.mockResolvedValue(null);

    const res = await POST(req(), params("nope"));

    expect(res.status).toBe(404);
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/history/[id]/screenshot - live-browser minute gate", () => {
  it("402s an exhausted meter with the reason, and never opens a browser", async () => {
    mockBrowserQuota.mockResolvedValue({
      allowed: false,
      usedSeconds: 3600,
      limitMinutes: 60,
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      creditBalanceSeconds: 0,
      message: "Browserbase minute quota exceeded.",
    });

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.statusCode).toBe("BROWSER_QUOTA_EXHAUSTED");
    expect(json.error).toBe("Browserbase minute quota exceeded.");
    // The whole point of checking up front: nothing is spent to find out.
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("captures once the meter allows it", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockBrowserQuota).toHaveBeenCalledWith(42);
    expect(mockCapture).toHaveBeenCalled();
  });
});
