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

const mockCheckAndRecordRequest = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  checkAndRecordRequest: (...args: unknown[]) =>
    mockCheckAndRecordRequest(...args),
  getRateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: vi.fn(async () => ({ safe: true })),
}));

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: vi.fn(async () => ({ allowed: true })),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

const mockCheckConcurrentScanLimit = vi.fn();
// reserveConcurrentScanSlot now performs the scan_history INSERT inside a
// locked transaction. The real helper uses pool.connect(); here we run the
// caller's insertRow against a fake client that delegates to mockQuery, so
// the INSERT still flows through the same mock the assertions below inspect.
const mockReserveConcurrentScanSlot = vi.fn(
  async (
    _userId: number,
    insertRow: (client: {
      query: (...a: unknown[]) => unknown;
    }) => Promise<number>,
  ) => {
    const scanId = await insertRow({
      query: (...a: unknown[]) => mockQuery(...a),
    });
    return { ok: true as const, scanId };
  },
);
vi.mock("@/lib/rate-limiting/concurrent-scans", () => ({
  checkConcurrentScanLimit: (...args: unknown[]) =>
    mockCheckConcurrentScanLimit(...args),
  reserveConcurrentScanSlot: (...args: unknown[]) =>
    mockReserveConcurrentScanSlot(
      ...(args as [
        number,
        (client: { query: (...a: unknown[]) => unknown }) => Promise<number>,
      ]),
    ),
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

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "203.0.113.5"),
  getUserAgent: vi.fn(async () => "vitest"),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
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
  mockCheckAndRecordRequest.mockReset();
  mockCheckAndRecordRequest.mockResolvedValue({
    allowed: true,
    limit: 100,
    used: 1,
    resetsAt: new Date().toISOString(),
  });
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });
  mockRecordUsage.mockReset();
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockIsUrlOwnedByUser.mockReset();
  mockIsUrlOwnedByUser.mockResolvedValue(true);
  mockCheckConcurrentScanLimit.mockReset();
  mockCheckConcurrentScanLimit.mockResolvedValue({
    allowed: true,
    current: 0,
    limit: 3,
  });
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
    // resolveScanIsPublic's account-default lookup, then the INSERT.
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
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
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await POST(postRequest({ url: "https://example.com" }));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall).toBeDefined();
    const [sql, params] = insertCall!;
    expect(sql).toContain("'pending'");
    // 2 planned sync categories + 3 planned async branches, per the mocks above.
    expect(params[4]).toBe(5);
    // is_public defaults to true (account has no private-by-default preference).
    expect(params[5]).toBe(true);
  });

  it("inserts is_public=false when the request explicitly asks for a private scan, without consulting the account default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    await POST(postRequest({ url: "https://example.com", isPublic: false }));

    // Only one query: the INSERT. An explicit isPublic in the request
    // short-circuits resolveScanIsPublic before it ever queries `users`.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("is_public");
    expect(params[5]).toBe(false);
  });

  it("inserts is_public=true when the request explicitly asks for a public scan, without consulting the account default", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 56 }] });

    await POST(postRequest({ url: "https://example.com", isPublic: true }));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[5]).toBe(true);
  });

  it("falls back to the account's scans_private_by_default setting when the request omits isPublic", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 57 }] });

    await POST(postRequest({ url: "https://example.com" }));

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![1][5]).toBe(false);
  });

  it("passes the created scanId and request context through to executeScan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
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
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
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

  it("rejects a session-auth request with 429 when the account's dailyScans quota is exhausted", async () => {
    mockCheckAndRecordRequest.mockResolvedValue({
      allowed: false,
      limit: 25,
      used: 25,
      resetsAt: new Date().toISOString(),
    });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily scan limit reached/i);
    expect(mockCheckAndRecordRequest).toHaveBeenCalledWith(42);
    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("records API key usage and returns rate limit headers for API-key auth", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 88 }] });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
    // The single rate-limit gate both counts+inserts the usage row AND supplies
    // the response headers, so it must run exactly once. Calling it a second
    // time (the old header path did) inserted a second usage row and charged the
    // scan twice. recordUsage is a no-op the route no longer calls.
    expect(mockCheckApiKeyRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).not.toHaveBeenCalled();
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
    const json = await res.json();
    expect(json.scanId).toBe(88);
    // dailyScans applies to API-key auth too, not just session cookies --
    // it's a distinct, usually much smaller cap than apiRequestsPerDay
    // (keyData.dailyLimit above), which alone used to bound API-triggered
    // scans (unbounded on a plan with apiRequestsPerDay: -1).
    expect(mockCheckAndRecordRequest).toHaveBeenCalledWith(42);
  });

  it("rejects an API-key request with 429 when the account's dailyScans quota is exhausted, even though the key's own rate limit still has room", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 5000, // plenty of apiRequestsPerDay room left
      needsTermsAcceptance: false,
    });
    mockCheckAndRecordRequest.mockResolvedValue({
      allowed: false,
      limit: 150,
      used: 150,
      resetsAt: new Date().toISOString(),
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily scan limit reached/i);
    expect(mockExecuteScan).not.toHaveBeenCalled();
  });

  it("emails the key owner (api_usage_alerts) and returns 429 without dispatching a scan when the API key is rate limited", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      email: "owner@example.com",
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 50,
      used: 50,
      remaining: 0,
      resetsAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
    expect(mockExecuteScan).not.toHaveBeenCalled();
    // Fire-and-forget, so give the microtask queue a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: "owner@example.com",
        type: "api_usage_alerts",
      }),
    );
  });

  it("still returns 429 even when the rate-limit notification email fails to send", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      email: "owner@example.com",
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 50,
      used: 50,
      remaining: 0,
      resetsAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    mockSendNotificationEmail.mockRejectedValue(new Error("smtp down"));

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
  });

  it("rejects an API key missing the scan:write scope with a message naming the scope, before touching the database", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:read"],
    });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("scan:write");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockExecuteScan).not.toHaveBeenCalled();
  });

  it("allows an API key that has the scan:write scope", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:write"],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 90 }] });

    const res = await POST(
      postRequest(
        { url: "https://example.com" },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
  });
});

describe("concurrent-scan capacity gate", () => {
  it("rejects with 429 when the caller is already at their plan's concurrent-scan limit", async () => {
    mockCheckConcurrentScanLimit.mockResolvedValue({
      allowed: false,
      current: 3,
      limit: 3,
      message: "capacity message",
    });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.statusCode).toBe("CONCURRENT_SCAN_LIMIT");
    expect(json.error).toBe("capacity message");
    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO scan_history"),
      ),
    ).toBe(false);
  });

  it("checks capacity for the caller's own user id before parsing the request body", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 4 }] });
    await POST(postRequest({ url: "https://example.com" }));
    expect(mockCheckConcurrentScanLimit).toHaveBeenCalledWith(42);
  });

  it("proceeds normally when under the concurrent-scan limit", async () => {
    mockCheckConcurrentScanLimit.mockResolvedValue({
      allowed: true,
      current: 1,
      limit: 3,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }] });
    const res = await POST(postRequest({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    expect(mockExecuteScan).toHaveBeenCalledTimes(1);
  });
});

describe("active-probes domain ownership gate", () => {
  it("never checks domain ownership for an ordinary scan that doesn't request active-probes", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com" }));
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
  });

  it("rejects with 403 when active-probes is requested against an unverified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({
        url: "https://example.com",
        scanners: ["headers", "active-probes"],
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(mockExecuteScan).not.toHaveBeenCalled();
    // The gate runs before the scan_history row would be created.
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO scan_history"),
      ),
    ).toBe(false);
  });

  it("rejects with 403 when a single per-probe selector is requested against an unverified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({
        url: "https://example.com",
        scanners: ["headers", "active-probes:xss"],
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(mockExecuteScan).not.toHaveBeenCalled();
  });

  it("checks ownership against the normalized URL for the caller's own user id", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    await POST(
      postRequest({
        url: "https://example.com/path",
        scanners: ["active-probes"],
      }),
    );
    expect(mockIsUrlOwnedByUser).toHaveBeenCalledWith(
      "https://example.com/path",
      42,
    );
  });

  it("proceeds normally when active-probes is requested against a verified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    const res = await POST(
      postRequest({
        url: "https://example.com",
        scanners: ["active-probes"],
      }),
    );
    expect(res.status).toBe(200);
    expect(mockExecuteScan).toHaveBeenCalledTimes(1);
  });
});

describe("port-scan domain ownership gate", () => {
  it("never checks domain ownership for a scan that doesn't opt into a port scan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com", portScan: false }));
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
  });

  it("rejects with 403 (DOMAIN_NOT_VERIFIED) when a port scan is requested against an unverified domain, before creating a row", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({ url: "https://example.com", portScan: true }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(json.error).toMatch(/port scan/i);
    expect(mockExecuteScan).not.toHaveBeenCalled();
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO scan_history"),
      ),
    ).toBe(false);
  });

  it("proceeds and threads portScan:true through to executeScan against a verified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(true);
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    const res = await POST(
      postRequest({ url: "https://example.com", portScan: true }),
    );
    expect(res.status).toBe(200);
    expect(mockIsUrlOwnedByUser).toHaveBeenCalledWith(
      "https://example.com",
      42,
    );
    expect(mockExecuteScan).toHaveBeenCalledWith(
      expect.objectContaining({ portScan: true }),
    );
  });

  it("passes portScan:false through to executeScan for an ordinary scan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ scans_private_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 4 }] });
    await POST(postRequest({ url: "https://example.com" }));
    expect(mockExecuteScan).toHaveBeenCalledWith(
      expect.objectContaining({ portScan: false }),
    );
  });
});
