/**
 * Route-level tests for POST /api/v3/history/[id]/ports, focused on the premium
 * plan gate (BUG 3), the short-TTL reuse (BUG 2), and the existing
 * verified-domain ownership gate.
 *
 * The real requireRefreshPlan -> userMeetsMinimumPlan chain runs; only its two
 * inputs (getSetting for BILLING_ENABLED and getUserPlan) are mocked. The
 * ownership lookup, domain-ownership check, rate limiter, port sweep, and DB
 * write are mocked at their module boundaries.
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

const mockScanPorts = vi.fn();
const mockReadPortScan = vi.fn();
const mockRecordPortScan = vi.fn();
vi.mock("@/lib/scanner/port-scan", () => ({
  scanPorts: (...a: unknown[]) => mockScanPorts(...a),
  readPortScan: (...a: unknown[]) => mockReadPortScan(...a),
  recordPortScan: (...a: unknown[]) => mockRecordPortScan(...a),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...a: unknown[]) => mockIsUrlOwnedByUser(...a),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));

const { POST } = await import("@/app/api/v3/history/[id]/ports/route");

function req() {
  return new NextRequest("http://localhost/api/v3/history/10/ports", {
    method: "POST",
  });
}
function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

const fakePortScan = {
  host: "example.com",
  scannedAt: "2026-01-01T00:00:00.000Z",
  portsScanned: 130,
  open: [],
  closed: [],
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
  mockScanPorts.mockReset().mockResolvedValue(fakePortScan);
  mockReadPortScan.mockReset().mockReturnValue(undefined);
  mockRecordPortScan.mockReset();
  mockIsUrlOwnedByUser.mockReset().mockResolvedValue(true);
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("POST /api/v3/history/[id]/ports - premium plan gate (BUG 3)", () => {
  it("402s a free user before the ownership check or the sweep", async () => {
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.statusCode).toBe("UPGRADE_REQUIRED");
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
    expect(mockScanPorts).not.toHaveBeenCalled();
  });

  it("402s a plan below Pro (core_supporter)", async () => {
    mockGetUserPlan.mockResolvedValue("core_supporter");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    expect(mockScanPorts).not.toHaveBeenCalled();
  });

  it("allows a paid (Pro) user and persists the fresh sweep", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.portScan).toEqual(fakePortScan);
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("result_meta = COALESCE"),
    );
    expect(update).toBeDefined();
    expect(JSON.parse(update![1][0])).toEqual({ portScan: fakePortScan });
  });

  it("allows everyone when billing is disabled (self-host), even a free plan", async () => {
    mockGetSetting.mockResolvedValue(false); // BILLING_ENABLED off
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockScanPorts).toHaveBeenCalled();
  });
});

describe("POST /api/v3/history/[id]/ports - verified-domain gate", () => {
  it("403s a paid user who has not verified the domain, without sweeping", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);

    const res = await POST(req(), params());

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(mockScanPorts).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/history/[id]/ports - short TTL reuse (BUG 2)", () => {
  it("reuses a cached sweep within the window instead of re-scanning", async () => {
    mockReadPortScan.mockReturnValue(fakePortScan);

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockScanPorts).not.toHaveBeenCalled();
    expect(mockRecordPortScan).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalled();
  });

  it("records a freshly captured sweep for the next refresh", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockRecordPortScan).toHaveBeenCalledWith("example.com", fakePortScan);
  });
});
