/**
 * Route-level tests for POST /api/v3/scan/bulk.
 *
 * This route used to run the whole scan pipeline INLINE, per URL, inside the
 * request, and this file used to test that pipeline through it. It no longer
 * does: like POST /api/v3/scan, it now validates, reserves one 'pending'
 * scan_history row per URL, dispatches the batch as a detached background job
 * (lib/scanner/execute-bulk-scan.ts) and returns the scan ids immediately.
 * ref: AUDIT-011#drift-06
 *
 * So what is tested here is admission, not scanning: who may submit a batch,
 * which URLs are refused and at what cost, what gets written, and that the
 * request returns without waiting for any scan. The scanning itself is
 * lib/scanner/execute-scan.ts's own suite.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SCANNING } from "@/lib/config/constants";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the assertions below depend on. The shipped registry
// default keeps the resolved value identical to the old static
// SCANNING.MAX_URL_LENGTH / SCANNING.MAX_URLS_IN_BULK constants.
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

const mockCheckSessionRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckSessionRateLimit(...args),
  };
});

const mockCanMakeRequest = vi.fn();
const mockGetDailyLimit = vi.fn();
const mockIncrementDailyCountCapped = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCanMakeRequest(...args),
  getDailyLimit: (...args: unknown[]) => mockGetDailyLimit(...args),
  incrementDailyCountCapped: (...args: unknown[]) =>
    mockIncrementDailyCountCapped(...args),
  getRateLimitHeaders: (info: { limit: number; remaining: number }) => ({
    "X-RateLimit-Limit": info.limit === -1 ? "unlimited" : String(info.limit),
    "X-RateLimit-Remaining":
      info.remaining === -1 ? "unlimited" : String(info.remaining),
  }),
}));

const mockValidateApiKey = vi.fn();
const mockCheckApiKeyRateLimit = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
  // The early-rejection check is the read-only peekRateLimit (it does not burn
  // a phantom slot). Same shape, and the route calls it before the per-URL
  // checkRateLimit loop, so aliasing both to one mock fn preserves the
  // call-order-based mockResolvedValueOnce setups below.
  peekRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
}));

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

const mockCheckTargetScanLimit = vi.fn();
vi.mock("@/lib/rate-limiting/target-limits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/target-limits")>();
  return {
    ...actual,
    checkTargetScanLimit: (...args: unknown[]) =>
      mockCheckTargetScanLimit(...args),
  };
});

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

vi.mock("@/lib/scanner/engine", () => ({
  getPlannedSyncCategories: () => ["headers", "ssl"],
}));

vi.mock("@/lib/scanner/async-checks", () => ({
  getPlannedAsyncBranches: () => ["dns", "tls", "live-fetch"],
}));

const mockRunBulkBatch = vi.fn();
vi.mock("@/lib/scanner/execute-bulk-scan", () => ({
  runBulkBatch: (...args: unknown[]) => mockRunBulkBatch(...args),
}));

const mockFinalizeScanFailure = vi.fn();
vi.mock("@/lib/scanner/scan-jobs", () => ({
  finalizeScanFailure: (...args: unknown[]) => mockFinalizeScanFailure(...args),
}));

// reserveConcurrentScanBatch performs every row's INSERT inside one locked
// transaction. Here the caller's insertRows runs against a fake client, so the
// INSERTs are inspectable without a real pool, and a refusal is drivable.
let nextScanId = 0;
const mockInsertQuery = vi.fn(async (_sql: string, _params: unknown[]) => ({
  rows: [{ id: ++nextScanId }],
}));
type BatchReservation =
  | { ok: true; scanIds: number[] }
  | { ok: false; check: Record<string, unknown> };
const mockReserveConcurrentScanBatch = vi.fn(
  async (
    _userId: number,
    insertRows: (client: {
      query: (sql: string, params: unknown[]) => unknown;
    }) => Promise<number[]>,
  ): Promise<BatchReservation> => ({
    ok: true,
    scanIds: await insertRows({ query: mockInsertQuery }),
  }),
);
vi.mock("@/lib/rate-limiting/concurrent-scans", () => ({
  reserveConcurrentScanBatch: (...args: unknown[]) =>
    mockReserveConcurrentScanBatch(
      ...(args as [
        number,
        (client: {
          query: (sql: string, params: unknown[]) => unknown;
        }) => Promise<number[]>,
      ]),
    ),
}));

// getUserPlanLimits is mocked directly (not left real) because it would
// otherwise issue an extra pool.query call this file's tests do not queue for.
// Defaults to null (the same "billing off or staff" shape getUserPlanLimits
// itself returns); withinPlanLimit/planLimitMessage stay the real, pure
// implementations.
const mockGetUserPlanLimits = vi.fn(
  async (_userId: number) => null as null | { bulkScanUrls: number },
);
vi.mock("@/lib/billing/plan-limits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/plan-limits")>();
  return {
    ...actual,
    getUserPlanLimits: (userId: number) => mockGetUserPlanLimits(userId),
  };
});

const { POST } = await import("@/app/api/v3/scan/bulk/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Every scan_history INSERT the batch's reservation transaction issued. */
function insertedRows() {
  return mockInsertQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO scan_history"),
  );
}

beforeEach(() => {
  nextScanId = 0;
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });

  mockInsertQuery.mockClear();
  mockReserveConcurrentScanBatch.mockClear();

  mockRunBulkBatch.mockReset();
  mockRunBulkBatch.mockResolvedValue(undefined);
  mockFinalizeScanFailure.mockReset();
  mockFinalizeScanFailure.mockResolvedValue(true);

  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });

  mockCheckSessionRateLimit.mockReset();
  mockCheckSessionRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });

  mockCanMakeRequest.mockReset();
  mockCanMakeRequest.mockResolvedValue({
    allowed: true,
    limit: 100,
    used: 0,
    remaining: 100,
    resetsAt: new Date().toISOString(),
  });
  mockGetDailyLimit.mockReset();
  mockGetDailyLimit.mockResolvedValue(100);
  mockIncrementDailyCountCapped.mockReset();
  mockIncrementDailyCountCapped.mockResolvedValue({ recorded: true, count: 1 });

  mockValidateApiKey.mockReset();
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });

  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });

  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });

  mockCheckTargetScanLimit.mockReset();
  mockCheckTargetScanLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    rootDomain: "example.com",
  });
  mockIsUrlOwnedByUser.mockReset();
  mockIsUrlOwnedByUser.mockResolvedValue(false);

  mockGetUserPlanLimits.mockReset();
  mockGetUserPlanLimits.mockResolvedValue(null);
});

describe("POST /api/v3/scan/bulk - auth", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(insertedRows()).toHaveLength(0);
  });

  it("rejects an invalid API key", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { urls: ["https://example.com"] },
        { authorization: "Bearer vr_live_bogus" },
      ),
    );

    expect(res.status).toBe(401);
  });

  it("rejects an API key whose user has not accepted updated terms", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 42,
      dailyLimit: 50,
      needsTermsAcceptance: true,
    });

    const res = await POST(
      postRequest(
        { urls: ["https://example.com"] },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(403);
  });

  it("rejects with 429 when the API key's daily limit is already exhausted", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 42,
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
        { urls: ["https://example.com"] },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(insertedRows()).toHaveLength(0);
  });

  it("rejects with 429 when the session bulk-scan rate limit is hit", async () => {
    mockCheckSessionRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/Bulk scan rate limit reached/);
    // This route answers 429 for three different things and only the daily
    // quota has an upgrade to offer, so each one names itself. The dashboard
    // used to tell them apart by matching the error text.
    expect(json.statusCode).toBe("BULK_RATE_LIMIT");
  });
});

describe("POST /api/v3/scan/bulk - request validation", () => {
  it("rejects a non-array urls field", async () => {
    const res = await POST(postRequest({ urls: "https://example.com" }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty urls array", async () => {
    const res = await POST(postRequest({ urls: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects when an entry is not a string", async () => {
    const res = await POST(postRequest({ urls: ["https://example.com", 42] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be a string URL/);
  });

  it("rejects a URL longer than the configured maximum length", async () => {
    const longUrl = `https://example.com/${"a".repeat(SCANNING.MAX_URL_LENGTH)}`;

    const res = await POST(postRequest({ urls: [longUrl] }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/exceeds maximum length/);
  });

  it("rejects a request over the configured MAX_URLS_IN_BULK cap before scanning anything", async () => {
    const urls = Array.from(
      { length: SCANNING.MAX_URLS_IN_BULK + 1 },
      (_, i) => `https://example.com/${i}`,
    );

    const res = await POST(postRequest({ urls }));

    expect(res.status).toBe(400);
    expect(insertedRows()).toHaveLength(0);
  });

  it("rejects a request over the caller's plan-tier bulk scan URL cap, even under MAX_URLS_IN_BULK", async () => {
    mockGetUserPlanLimits.mockResolvedValue({ bulkScanUrls: 1 });

    const res = await POST(
      postRequest({ urls: ["https://a.example.com", "https://b.example.com"] }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/URLs per bulk scan/);
    expect(insertedRows()).toHaveLength(0);
  });

  it("allows a request exactly at the caller's plan-tier bulk scan URL cap", async () => {
    mockGetUserPlanLimits.mockResolvedValue({ bulkScanUrls: 2 });

    const res = await POST(
      postRequest({
        urls: ["https://example.com/a", "https://example.com/b"],
      }),
    );

    expect(res.status).toBe(200);
  });

  it("accepts a request exactly at the MAX_URLS_IN_BULK cap", async () => {
    const urls = Array.from(
      { length: SCANNING.MAX_URLS_IN_BULK },
      (_, i) => `https://example.com/${i}`,
    );

    const res = await POST(postRequest({ urls }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(SCANNING.MAX_URLS_IN_BULK);
  });

  it("rejects when none of the submitted URLs are parseable or supported", async () => {
    const res = await POST(
      postRequest({ urls: ["not a url at all", "ssh://example.com:22"] }),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("No valid URLs provided.");
    expect(insertedRows()).toHaveLength(0);
  });
});

describe("POST /api/v3/scan/bulk - queueing", () => {
  it("reserves a pending row per URL and returns its scan id without running the scan", async () => {
    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.queued).toBe(1);
    expect(json.failed).toBe(0);
    expect(json.skipped).toBe(0);
    expect(json.results[0]).toEqual({
      url: "https://example.com/",
      success: true,
      scanId: 1,
      status: "queued",
    });

    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    const [sql, params] = rows[0];
    expect(sql).toContain("INSERT INTO scan_history");
    expect(sql).toContain("'pending'");
    expect(params[0]).toBe(42); // user_id
    expect(params[1]).toBe("https://example.com/"); // normalized url
    expect(params[2]).toBe("web"); // source
  });

  it("dispatches the batch as a detached background job instead of awaiting it", async () => {
    // The whole point of the change: a batch that takes minutes must not hold
    // the HTTP request open (a proxy in front of the app cuts it at ~100s and
    // the scans keep running unobserved). The response must resolve even if
    // the batch job never does.
    let releaseBatch: (() => void) | undefined;
    mockRunBulkBatch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseBatch = resolve;
        }),
    );

    const res = await POST(
      postRequest({
        urls: ["https://one.example.com", "https://two.example.com"],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(2);
    expect(mockRunBulkBatch).toHaveBeenCalledTimes(1);
    const [batchArgs] = mockRunBulkBatch.mock.calls[0];
    expect(batchArgs.authedUserId).toBe(42);
    expect(batchArgs.scans.map((s: { scanId: number }) => s.scanId)).toEqual([
      1, 2,
    ]);
    expect(batchArgs.scans[0].url).toBe("https://one.example.com/");

    releaseBatch?.();
  });

  it("records source='api' and still enforces dailyScans quota for API-key auth", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 99,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });

    const res = await POST(
      postRequest(
        { urls: ["https://example.com"] },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    const [, params] = rows[0];
    expect(params[0]).toBe(99);
    expect(params[2]).toBe("api");

    // dailyScans applies regardless of auth method -- API-key requests used
    // to skip it entirely, bounded only by apiRequestsPerDay (unbounded on
    // a plan with apiRequestsPerDay: -1).
    expect(mockCanMakeRequest).toHaveBeenCalledWith(99);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledWith(99, 100);
  });

  it("rejects an API-key bulk request with 429 when dailyScans is exhausted, even though the key's own limit has room", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 1,
      userId: 99,
      dailyLimit: 5000,
      needsTermsAcceptance: false,
    });
    mockCanMakeRequest.mockResolvedValue({
      allowed: false,
      limit: 150,
      used: 150,
      remaining: 0,
      resetsAt: new Date().toISOString(),
    });

    const res = await POST(
      postRequest(
        { urls: ["https://example.com"] },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/daily scan limit reached/i);
    expect(insertedRows()).toHaveLength(0);
  });

  it("inserts is_public=true by default and is_public=false when the batch is private", async () => {
    await POST(postRequest({ urls: ["https://example.com"] }));
    expect(insertedRows()[0][1][5]).toBe(true);

    mockInsertQuery.mockClear();
    await POST(postRequest({ urls: ["https://example.com"], isPublic: false }));
    expect(insertedRows()[0][1][5]).toBe(false);
  });

  it("returns 500 without dispatching anything when the reservation transaction fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockReserveConcurrentScanBatch.mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(500);
    expect(mockRunBulkBatch).not.toHaveBeenCalled();
    // Nothing was charged: the daily counter is only touched once a row exists.
    expect(mockIncrementDailyCountCapped).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("returns the concurrency 429 without charging any quota when the account is already at capacity", async () => {
    mockReserveConcurrentScanBatch.mockResolvedValueOnce({
      ok: false,
      check: {
        allowed: false,
        current: 1,
        limit: 1,
        message: "You already have 1 scan(s) running.",
      },
    });

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.statusCode).toBe("CONCURRENT_SCAN_LIMIT");
    expect(mockIncrementDailyCountCapped).not.toHaveBeenCalled();
    expect(mockRunBulkBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/bulk - per-URL refusals", () => {
  it("reports an SSRF rejection from validateScanTarget without aborting the batch, and charges nothing for it", async () => {
    mockValidateScanTarget
      .mockResolvedValueOnce({ safe: false, reason: "Internal IP blocked." })
      .mockResolvedValueOnce({ safe: true });

    const res = await POST(
      postRequest({
        urls: ["https://blocked.example.com", "https://example.com"],
      }),
    );

    const json = await res.json();
    expect(json.results[0]).toEqual(
      expect.objectContaining({
        success: false,
        error: "Internal IP blocked.",
      }),
    );
    expect(json.results[1].success).toBe(true);
    // The rejected URL never reaches access-rules, never gets a row, and never
    // costs a daily scan: both gates run BEFORE anything is reserved or
    // charged, so a blocked target cannot burn quota for work that never ran.
    expect(mockCheckAccessRules).toHaveBeenCalledTimes(1);
    expect(insertedRows()).toHaveLength(1);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(1);
  });

  it("reports an access-rules rejection with a generic message, without aborting the batch", async () => {
    mockCheckAccessRules
      .mockResolvedValueOnce({ allowed: false })
      .mockResolvedValueOnce({ allowed: true });

    const res = await POST(
      postRequest({
        urls: ["https://blacklisted.example.com", "https://example.com"],
      }),
    );

    const json = await res.json();
    expect(json.results[0]).toEqual(
      expect.objectContaining({
        success: false,
        error: "This target cannot be scanned.",
      }),
    );
    expect(json.results[0].details).toMatch(/restricted from scanning/);
    expect(json.results[1].success).toBe(true);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(1);
  });

  /**
   * AUDIT-012#abuse-05: every other limiter is keyed on the caller, so total
   * volume aimed at one victim was bounded only by how many accounts the
   * requester was willing to create.
   */
  it("refuses a URL whose target has been scanned too much, unless the caller owns the domain", async () => {
    mockCheckTargetScanLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 900,
      rootDomain: "victim.example",
    });

    const res = await POST(
      postRequest({ urls: ["https://www.victim.example/"] }),
    );

    const json = await res.json();
    expect(json.queued).toBe(0);
    expect(json.results[0].error).toMatch(/scanned too many times/i);
    expect(mockIsUrlOwnedByUser).toHaveBeenCalledTimes(1);
    expect(mockIncrementDailyCountCapped).not.toHaveBeenCalled();
  });

  it("lets a verified domain owner past the per-target limit, and asks only once per domain", async () => {
    mockCheckTargetScanLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 900,
      rootDomain: "mine.example",
    });
    mockIsUrlOwnedByUser.mockResolvedValue(true);

    const res = await POST(
      postRequest({
        urls: ["https://mine.example/a", "https://mine.example/b"],
      }),
    );

    const json = await res.json();
    expect(json.queued).toBe(2);
    // Cached per registrable domain: two URLs, one ownership lookup.
    expect(mockIsUrlOwnedByUser).toHaveBeenCalledTimes(1);
  });

  it("returns without reserving anything when every URL is refused", async () => {
    mockCheckAccessRules.mockResolvedValue({ allowed: false });

    const res = await POST(
      postRequest({
        urls: [
          "https://blocked.example.com/a",
          "https://blocked.example.com/b",
        ],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(0);
    expect(json.failed).toBe(2);
    expect(mockReserveConcurrentScanBatch).not.toHaveBeenCalled();
    expect(mockRunBulkBatch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/bulk - per-batch work is not repeated per URL", () => {
  // AUDIT-012#perf-18: a 100-URL batch performed on the order of 900 to 1000
  // serialized database round trips, a large share of them re-answering the
  // same two questions ("what is this user's daily cap" and "is this host
  // blocklisted") once per URL.
  it("resolves the daily limit once for the whole batch, not once per URL", async () => {
    const res = await POST(
      postRequest({
        urls: [
          "https://one.example.com",
          "https://two.example.com",
          "https://three.example.com",
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockGetDailyLimit).toHaveBeenCalledTimes(1);
    // The charge itself still happens per URL, atomically.
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(3);
  });

  it("checks the access rules once per host, not once per URL", async () => {
    const res = await POST(
      postRequest({
        urls: [
          "https://example.com/a",
          "https://example.com/b",
          "https://example.com/c",
          "https://other.example.net/a",
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockCheckAccessRules).toHaveBeenCalledTimes(2);
  });

  it("re-runs the SSRF guard for every URL, since it resolves DNS", async () => {
    const res = await POST(
      postRequest({
        urls: ["https://example.com/a", "https://example.com/b"],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockValidateScanTarget).toHaveBeenCalledWith(
      "https://example.com/a",
    );
    expect(mockValidateScanTarget).toHaveBeenCalledWith(
      "https://example.com/b",
    );
  });
});

describe("POST /api/v3/scan/bulk - daily quota", () => {
  it("rejects the whole request with 429 when the session has no remaining daily quota at all", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: false,
      limit: 100,
      used: 100,
      remaining: 0,
      resetsAt: new Date().toISOString(),
    });

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/Daily scan limit reached/);
    // The one 429 with an upgrade path. The dashboard opens the plan modal on
    // this and only this, so it must be distinguishable from the burst limiter
    // and the concurrency refusal without reading the copy.
    expect(json.statusCode).toBe("DAILY_LIMIT");
    expect(insertedRows()).toHaveLength(0);
  });

  it("queues only as many URLs as remain in the daily quota and marks the rest skipped", async () => {
    mockCanMakeRequest.mockResolvedValue({
      allowed: true,
      limit: 100,
      used: 98,
      remaining: 2,
      resetsAt: new Date().toISOString(),
    });

    const res = await POST(
      postRequest({
        urls: [
          "https://one.example.com",
          "https://two.example.com",
          "https://three.example.com",
        ],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(3);
    expect(json.queued).toBe(2);
    expect(json.skipped).toBe(1);
    expect(json.results[2]).toEqual(
      expect.objectContaining({
        url: "https://three.example.com/",
        success: false,
        error: expect.stringMatching(/Daily scan limit reached/),
      }),
    );
    expect(insertedRows()).toHaveLength(2);
    expect(mockIncrementDailyCountCapped).toHaveBeenCalledTimes(2);
  });

  it("closes out the reserved rows it cannot charge instead of leaving them pending", async () => {
    // The atomic capped increment is what really enforces the cap, and it can
    // refuse mid-batch (a concurrent scan consumed the last slot). Those rows
    // already exist, so they have to be failed explicitly or they sit
    // 'pending' forever, holding concurrency and showing as stuck scans.
    mockIncrementDailyCountCapped
      .mockResolvedValueOnce({ recorded: true, count: 1 })
      .mockResolvedValue({ recorded: false, count: 100 });

    const res = await POST(
      postRequest({
        urls: [
          "https://one.example.com",
          "https://two.example.com",
          "https://three.example.com",
        ],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(1);
    expect(json.failed).toBe(2);
    expect(mockFinalizeScanFailure).toHaveBeenCalledTimes(2);
    expect(mockFinalizeScanFailure).toHaveBeenCalledWith(
      2,
      expect.stringMatching(/Daily scan limit reached/),
    );
    expect(mockFinalizeScanFailure).toHaveBeenCalledWith(
      3,
      expect.stringMatching(/Daily scan limit reached/),
    );
    // Only the URL that was actually charged is handed to the background job.
    const [batchArgs] = mockRunBulkBatch.mock.calls[0];
    expect(batchArgs.scans).toHaveLength(1);
  });
});

describe("POST /api/v3/scan/bulk - API key per-URL rate limiting", () => {
  it("fails the remaining URLs once the API key's per-URL limit is hit mid-batch", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 7,
      userId: 42,
      dailyLimit: 2,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit
      .mockResolvedValueOnce({
        allowed: true,
        limit: 2,
        used: 0,
        remaining: 2,
        resetsAt: new Date().toISOString(),
      }) // early peek
      .mockResolvedValueOnce({
        allowed: true,
        limit: 2,
        used: 1,
        remaining: 1,
        resetsAt: new Date().toISOString(),
      }) // url1
      .mockResolvedValueOnce({
        allowed: false,
        limit: 2,
        used: 2,
        remaining: 0,
        resetsAt: new Date().toISOString(),
      }); // url2 - exhausted

    const res = await POST(
      postRequest(
        {
          urls: [
            "https://one.example.com",
            "https://two.example.com",
            "https://three.example.com",
          ],
        },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.queued).toBe(1);
    expect(json.failed).toBe(2);
    expect(json.results[0].success).toBe(true);
    expect(json.results[1]).toEqual(
      expect.objectContaining({
        success: false,
        error: "API key daily limit reached mid-batch.",
      }),
    );
    expect(json.results[2]).toEqual(
      expect.objectContaining({
        success: false,
        error: "API key daily limit reached mid-batch.",
      }),
    );
    // The two URLs that lost their charge had their reserved rows closed out.
    expect(mockFinalizeScanFailure).toHaveBeenCalledTimes(2);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  /**
   * Regression for the "remaining" slice using indexOf instead of the loop
   * index: with a duplicate URL earlier in the batch, exhausting the quota on
   * the SECOND occurrence used to resolve back to just after the FIRST one,
   * re-pushing an already-processed entry and inflating queued + failed past
   * total.
   */
  it("keeps queued + failed === total when a duplicate URL trips the API key quota mid-batch", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 7,
      userId: 42,
      dailyLimit: 2,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit
      .mockResolvedValueOnce({
        allowed: true,
        limit: 2,
        used: 0,
        remaining: 2,
        resetsAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        allowed: true,
        limit: 2,
        used: 1,
        remaining: 1,
        resetsAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        allowed: false,
        limit: 2,
        used: 2,
        remaining: 0,
        resetsAt: new Date().toISOString(),
      });

    const res = await POST(
      postRequest(
        {
          urls: [
            "https://one.example.com",
            "https://one.example.com",
            "https://two.example.com",
          ],
        },
        { authorization: "Bearer vr_live_testkey" },
      ),
    );

    const json = await res.json();
    expect(json.total).toBe(3);
    expect(json.results).toHaveLength(3);
    expect(json.queued + json.failed).toBe(json.total);
    expect(json.results[0]).toEqual(
      expect.objectContaining({
        url: "https://one.example.com/",
        success: true,
      }),
    );
    expect(json.results[1]).toEqual(
      expect.objectContaining({
        url: "https://one.example.com/",
        success: false,
      }),
    );
    expect(json.results[2]).toEqual(
      expect.objectContaining({
        url: "https://two.example.com/",
        success: false,
      }),
    );
  });
});

describe("POST /api/v3/scan/bulk - response rate limit headers", () => {
  it("computes final quota headers from canMakeRequest for session auth", async () => {
    mockCanMakeRequest
      .mockResolvedValueOnce({
        allowed: true,
        limit: 100,
        used: 1,
        remaining: 99,
        resetsAt: new Date().toISOString(),
      })
      .mockResolvedValueOnce({
        allowed: true,
        limit: 100,
        used: 2,
        remaining: 98,
        resetsAt: new Date().toISOString(),
      });

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(200);
    expect(mockCanMakeRequest).toHaveBeenCalledTimes(2);
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("98");
  });
});
