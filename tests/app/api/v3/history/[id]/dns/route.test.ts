/**
 * Route-level tests for POST /api/v3/history/[id]/dns, focused on the premium
 * plan gate (BUG 3) and the short-TTL reuse (BUG 2).
 *
 * The real requireRefreshPlan -> userMeetsMinimumPlan -> planMeetsMinimum chain
 * runs; only its two inputs are mocked (getSetting for BILLING_ENABLED and
 * getUserPlan), so the "free user is blocked / paid user allowed / billing-off
 * allows everyone" behavior is exercised end-to-end rather than stubbed. The
 * ownership lookup, rate limiter, DNS capture, and DB write are mocked at their
 * module boundaries.
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

const mockResolveDnsRecords = vi.fn();
const mockHasAnyDnsRecords = vi.fn();
const mockReadDnsRecords = vi.fn();
const mockRecordDnsRecords = vi.fn();
vi.mock("@/lib/scanner/dns-records", () => ({
  resolveDnsRecords: (...a: unknown[]) => mockResolveDnsRecords(...a),
  hasAnyDnsRecords: (...a: unknown[]) => mockHasAnyDnsRecords(...a),
  readDnsRecords: (...a: unknown[]) => mockReadDnsRecords(...a),
  recordDnsRecords: (...a: unknown[]) => mockRecordDnsRecords(...a),
}));

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...a: unknown[]) => mockQuery(...a) },
}));

const { POST } = await import("@/app/api/v3/history/[id]/dns/route");

function req() {
  return new NextRequest("http://localhost/api/v3/history/10/dns", {
    method: "POST",
  });
}
function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

const fakeRecords = {
  hostname: "example.com",
  resolvedAt: "2026-01-01T00:00:00.000Z",
  a: ["1.2.3.4"],
  aaaa: [],
  cname: [],
  mx: [],
  ns: [],
  txt: [],
  caa: [],
  soa: null,
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
  mockResolveDnsRecords.mockReset().mockResolvedValue(fakeRecords);
  mockHasAnyDnsRecords.mockReset().mockReturnValue(true);
  mockReadDnsRecords.mockReset().mockReturnValue(undefined);
  mockRecordDnsRecords.mockReset();
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

describe("POST /api/v3/history/[id]/dns - premium plan gate (BUG 3)", () => {
  it("402s a free user and never runs the DNS capture", async () => {
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.statusCode).toBe("UPGRADE_REQUIRED");
    expect(mockResolveDnsRecords).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });

  it("402s a plan below Pro (core_supporter)", async () => {
    mockGetUserPlan.mockResolvedValue("core_supporter");

    const res = await POST(req(), params());

    expect(res.status).toBe(402);
    expect(mockResolveDnsRecords).not.toHaveBeenCalled();
  });

  it("allows a paid (Pro) user and persists the fresh records", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dnsRecords).toEqual(fakeRecords);
    expect(mockResolveDnsRecords).toHaveBeenCalledWith("example.com");
    // Persisted back into result_meta.
    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("result_meta = COALESCE"),
    );
    expect(update).toBeDefined();
    expect(JSON.parse(update![1][0])).toEqual({ dnsRecords: fakeRecords });
  });

  it("allows everyone when billing is disabled (self-host), even a free plan", async () => {
    mockGetSetting.mockResolvedValue(false); // BILLING_ENABLED off
    mockGetUserPlan.mockResolvedValue("free");

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockResolveDnsRecords).toHaveBeenCalled();
  });
});

describe("POST /api/v3/history/[id]/dns - short TTL reuse (BUG 2)", () => {
  it("reuses a cached capture within the window instead of re-resolving", async () => {
    mockReadDnsRecords.mockReturnValue(fakeRecords);

    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    // Reused: no fresh resolve, no new record write.
    expect(mockResolveDnsRecords).not.toHaveBeenCalled();
    expect(mockRecordDnsRecords).not.toHaveBeenCalled();
    // Still persisted to result_meta.
    expect(mockQuery).toHaveBeenCalled();
  });

  it("records a freshly resolved capture for the next refresh", async () => {
    const res = await POST(req(), params());

    expect(res.status).toBe(200);
    expect(mockRecordDnsRecords).toHaveBeenCalledWith("example.com", fakeRecords);
  });
});

describe("POST /api/v3/history/[id]/dns - ownership", () => {
  it("401s an unauthenticated caller before checking the plan", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(req(), params());

    expect(res.status).toBe(401);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
  });

  it("404s a scan the caller does not own", async () => {
    mockResolveScanRow.mockResolvedValue({
      id: 10,
      user_id: 999,
      url: "https://example.com",
    });

    const res = await POST(req(), params());

    expect(res.status).toBe(404);
    expect(mockResolveDnsRecords).not.toHaveBeenCalled();
  });
});
