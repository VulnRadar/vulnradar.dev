/**
 * Route-level tests for POST /api/v3/scan.
 *
 * The actual scan work (lib/scanner/execute-scan.ts) has its own suite;
 * this exercises only what the route itself is responsible for now that a
 * scan is a background job: creating the scan_history row immediately,
 * dispatching the job without awaiting it, and returning
 * { scanId, status: "running" } right away instead of holding the request
 * open until the scan finishes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the scan_history assertions below depend on. The
// shipped registry default keeps the resolved value identical to the old
// static SCANNING.MAX_URL_LENGTH constant.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
    getSettings: vi.fn(async (keys: (keyof typeof SETTINGS_REGISTRY)[]) =>
      Object.fromEntries(keys.map((k) => [k, SETTINGS_REGISTRY[k].default])),
    ),
  };
});

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    })),
  };
});

vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  checkAndRecordRequest: vi.fn(async () => ({
    allowed: true,
    limit: 100,
    used: 1,
    resetsAt: new Date().toISOString(),
  })),
  getRateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/scanner/engine", () => ({
  getPlannedSyncCategories: () => ["headers", "ssl"],
}));

vi.mock("@/lib/scanner/async-checks", () => ({
  getPlannedAsyncBranches: () => ["dns", "tls", "live-fetch"],
}));

const mockExecuteScan = vi.fn();
vi.mock("@/lib/scanner/execute-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/execute-scan")>();
  return {
    ...actual,
    executeScan: (...args: unknown[]) => mockExecuteScan(...args),
  };
});

const mockValidateApiKey = vi.fn();
const mockCheckApiKeyRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
}));

const { POST } = await import("@/app/api/v3/scan/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockExecuteScan.mockReset();
  mockExecuteScan.mockResolvedValue(undefined);
  mockValidateApiKey.mockReset();
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });
  mockRecordUsage.mockReset();
});

describe("POST /api/v3/scan", () => {
  it("creates a pending row, returns immediately, and does not wait for the scan to finish", async () => {
    let resolveExecute: () => void = () => {};
    mockExecuteScan.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveExecute = resolve;
        }),
    );
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 123 }] });

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ scanId: 123, status: "running" });

    // executeScan was dispatched but never awaited by the handler — the
    // response above already resolved even though this promise is still
    // pending.
    expect(mockExecuteScan).toHaveBeenCalledTimes(1);
    resolveExecute();
  });

  it("inserts the row with status='pending' and the planned categories total", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await POST(postRequest({ url: "https://example.com" }));

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("'pending'");
    expect(sql).toContain("INSERT INTO scan_history");
    // 2 planned sync categories + 3 planned async branches, per the mocks above.
    expect(params[4]).toBe(5);
  });

  it("passes the created scanId and request context through to executeScan", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 77 }] });

    await POST(postRequest({ url: "https://example.com" }));

    expect(mockExecuteScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: 77,
        normalizedUrl: "https://example.com",
        authedUserId: 42,
        categoriesTotal: 5,
      }),
    );
  });

  it("returns 500 and never dispatches a scan when the row cannot be created", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(500);
    expect(mockExecuteScan).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ url: "https://example.com" }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteScan).not.toHaveBeenCalled();
  });

  it("rejects a missing URL before creating a row", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("records API key usage and returns rate limit headers for API-key auth", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 88 }] });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(9);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
    const json = await res.json();
    expect(json.scanId).toBe(88);
  });
});
