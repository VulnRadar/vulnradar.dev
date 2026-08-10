/**
 * Route-level tests for POST /api/v3/scan/bulk.
 *
 * Unlike app/api/v3/scan/route.ts (now a background job dispatcher), this
 * route still runs the whole scan pipeline inline, per URL, sequentially,
 * inside the request. These tests mock the network and database boundary
 * (pool, getSession, rate limiting, safeFetch/validateScanTarget,
 * checkAccessRules) and let the real check pipeline run: runSyncChecks,
 * runAsyncChecks, getProtocolFromUrl, runWebSocketChecks, runFtpChecks, and
 * redactSensitiveResponseHeaders all execute for real against the mocked
 * safeFetch response.
 *
 * runAsyncChecks reaches past safeFetch straight to node:dns, node:tls, and
 * the global fetch for its DNS / TLS / live-fetch sub-checks (it never goes
 * through safeFetch), so those three primitives are stubbed here as well.
 * This is the same network-boundary mocking tests/lib/scanner/async-checks.test.ts
 * uses to exercise async-checks.ts directly; without it every test in this
 * file would make real DNS lookups and real HTTPS requests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SCANNING } from "@/lib/config/constants";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the "not called" assertions below depend on. The
// shipped registry default keeps the resolved value identical to the old
// static SCANNING.MAX_URL_LENGTH / SCANNING.MAX_URLS_IN_BULK constants.
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
const mockIncrementDailyCount = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  canMakeRequest: (...args: unknown[]) => mockCanMakeRequest(...args),
  incrementDailyCount: (...args: unknown[]) => mockIncrementDailyCount(...args),
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
}));

const mockSafeFetch = vi.fn();
const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
  // async-checks.ts (deliberately not mocked - see file header) imports this
  // directly. A minimal real-ish implementation keeps its live-fetch /
  // exposed-file sub-checks on the same "fetch, then fail closed because the
  // global fetch below is stubbed" path they take in production, instead of
  // throwing on `undefined(...)` because the mock omitted the export.
  isPrivateHostname: (hostname: string) => {
    const h = hostname.toLowerCase();
    return (
      h === "localhost" ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h.endsWith(".lan") ||
      /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  },
}));

const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

// See file header: runAsyncChecks is exercised for real, so its underlying
// network primitives are stubbed here instead.
vi.mock("dns/promises", () => ({
  resolveTxt: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveCname: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveCaa: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveNs: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolveMx: vi
    .fn()
    .mockRejectedValue(new Error("mock: dns disabled in tests")),
  resolve4: vi.fn().mockRejectedValue(new Error("mock: dns disabled in tests")),
}));

vi.mock("tls", () => ({
  connect: vi.fn(),
  default: { connect: vi.fn() },
}));

const { POST } = await import("@/app/api/v3/scan/bulk/route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/scan/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function htmlResponse(
  body = "<html><body>hi</body></html>",
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", ...headers },
  });
}

async function insertedRows() {
  return mockQuery.mock.calls.filter(([sql]) =>
    String(sql).includes("INSERT INTO scan_history"),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [{ id: 1 }] });

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
  mockIncrementDailyCount.mockReset();
  mockIncrementDailyCount.mockResolvedValue(1);

  mockValidateApiKey.mockReset();
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });

  mockSafeFetch.mockReset();
  // A fresh Response per call: reusing one instance across multiple URLs
  // would fail on the 2nd+ read with "ReadableStream is locked", since
  // safeReadBody() calls response.body.getReader() once per response.
  mockSafeFetch.mockImplementation(async () => htmlResponse());
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });

  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("mock: network disabled in tests")),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/v3/scan/bulk - auth", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/Unauthorized/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest(
        { urls: ["https://example.com"] },
        { authorization: "Bearer bad-key" },
      ),
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid or revoked API key.");
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
    const json = await res.json();
    expect(json.error).toBe("Rate limit exceeded.");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
    expect(mockQuery).not.toHaveBeenCalled();
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
    expect(json.error).toMatch(/2 minute/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/bulk - request validation", () => {
  it("rejects a non-array urls field", async () => {
    const res = await POST(postRequest({ urls: "https://example.com" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Provide an array of URLs.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an empty urls array", async () => {
    const res = await POST(postRequest({ urls: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Provide an array of URLs.");
  });

  it("rejects when an entry is not a string", async () => {
    const res = await POST(
      postRequest({ urls: ["https://example.com", 12345] }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Each entry must be a string URL.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a URL longer than the configured maximum length", async () => {
    const tooLong =
      "https://example.com/" + "a".repeat(SCANNING.MAX_URL_LENGTH);
    const res = await POST(postRequest({ urls: [tooLong] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe(
      `URL exceeds maximum length of ${SCANNING.MAX_URL_LENGTH} characters.`,
    );
  });

  it("rejects a request over the configured MAX_URLS_IN_BULK cap before scanning anything", async () => {
    const urls = Array.from(
      { length: SCANNING.MAX_URLS_IN_BULK + 1 },
      (_, i) => `https://example.com/${i}`,
    );

    const res = await POST(postRequest({ urls }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe(
      `Maximum ${SCANNING.MAX_URLS_IN_BULK} URLs per bulk scan.`,
    );
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockSafeFetch).not.toHaveBeenCalled();
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
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/bulk - single URL scan and persistence", () => {
  it("scans a single HTTP URL end to end and records it in scan_history", async () => {
    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.successful).toBe(1);
    expect(json.failed).toBe(0);
    expect(json.skipped).toBe(0);
    expect(json.results[0].success).toBe(true);
    expect(json.results[0].scanHistoryId).toBe(1);
    expect(typeof json.results[0].duration).toBe("number");

    const rows = await insertedRows();
    expect(rows).toHaveLength(1);
    const [sql, params] = rows[0];
    expect(sql).toContain("INSERT INTO scan_history");
    expect(params[0]).toBe(42); // user_id
    expect(params[1]).toBe("https://example.com/"); // normalized url
    expect(params[7]).toBe("web"); // source
  });

  it("records source='api' and does not touch session daily-quota bookkeeping for API-key auth", async () => {
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
    const rows = await insertedRows();
    expect(rows).toHaveLength(1);
    const [, params] = rows[0];
    expect(params[0]).toBe(99);
    expect(params[7]).toBe("api");

    expect(mockIncrementDailyCount).not.toHaveBeenCalled();
    expect(mockCanMakeRequest).not.toHaveBeenCalled();
  });

  it("inserts is_public=true by default and upserts host_reputation for the batch", async () => {
    await POST(postRequest({ urls: ["https://example.com"] }));

    const rows = await insertedRows();
    const [, params] = rows[0];
    expect(params[10]).toBe(true);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(1);
  });

  it("inserts is_public=false and skips host_reputation when the batch is requested private", async () => {
    await POST(postRequest({ urls: ["https://example.com"], isPublic: false }));

    const rows = await insertedRows();
    const [, params] = rows[0];
    expect(params[10]).toBe(false);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(0);
  });

  it("redacts sensitive response headers before persisting them", async () => {
    mockSafeFetch.mockResolvedValue(
      htmlResponse("<html></html>", { "set-cookie": "sid=abc123; HttpOnly" }),
    );

    await POST(postRequest({ urls: ["https://example.com"] }));

    const rows = await insertedRows();
    const [, params] = rows[0];
    const storedHeaders = JSON.parse(params[8]);
    expect(storedHeaders["set-cookie"]).toBe("[redacted]");
  });

  it("still returns success:true with a null scanHistoryId when the DB insert fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("db unavailable"));

    const res = await POST(postRequest({ urls: ["https://example.com"] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results[0].success).toBe(true);
    expect(json.results[0].scanHistoryId).toBeNull();

    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/v3/scan/bulk - one URL fails, others succeed", () => {
  it("keeps scanning later URLs when an earlier one cannot be reached, and only persists the successful one", async () => {
    mockSafeFetch
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(htmlResponse());

    const res = await POST(
      postRequest({
        urls: ["https://unreachable.example.com", "https://example.com"],
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.total).toBe(2);
    expect(json.successful).toBe(1);
    expect(json.failed).toBe(1);
    expect(json.results[0].success).toBe(false);
    expect(json.results[0].error).toMatch(/Could not reach/);
    expect(json.results[1].success).toBe(true);

    // Daily quota is still consumed for the URL that failed to fetch.
    expect(mockIncrementDailyCount).toHaveBeenCalledTimes(2);
    // Only the successful scan reaches the DB insert.
    const rows = await insertedRows();
    expect(rows).toHaveLength(1);
  });

  it("reports a per-URL SSRF rejection from validateScanTarget without aborting the batch", async () => {
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
    // The rejected URL never reaches access-rules or safeFetch. The one
    // successful scan makes 2 calls: the page fetch, plus the async
    // bucket-listing check's own follow-up homepage fetch.
    expect(mockCheckAccessRules).toHaveBeenCalledTimes(1);
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
  });

  it("reports a per-URL access-rules rejection with a generic message, without aborting the batch", async () => {
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
    // The one successful scan makes 2 calls: the page fetch, plus the async
    // bucket-listing check's own follow-up homepage fetch.
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v3/scan/bulk - protocol routing", () => {
  it("routes a ws:// URL through the websocket path, converting to http for the initial fetch", async () => {
    const res = await POST(postRequest({ urls: ["ws://example.com/socket"] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results[0].success).toBe(true);

    expect(mockSafeFetch).toHaveBeenCalledWith(
      "http://example.com/socket",
      expect.any(Object),
      ["example.com"],
    );

    const rows = await insertedRows();
    const findings = JSON.parse(rows[0][1][3]);
    expect(
      findings.some((f: { id: string }) =>
        f.id.startsWith("ws-insecure-connection"),
      ),
    ).toBe(true);
  });

  it("routes an ftp:// URL through the FTP path without ever calling safeFetch", async () => {
    const res = await POST(postRequest({ urls: ["ftp://example.com"] }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results[0].success).toBe(true);
    expect(mockSafeFetch).not.toHaveBeenCalled();

    const rows = await insertedRows();
    const findings = JSON.parse(rows[0][1][3]);
    expect(
      findings.some((f: { id: string }) =>
        f.id.startsWith("ftp-insecure-connection"),
      ),
    ).toBe(true);
    expect(
      findings.some((f: { id: string }) => f.id.startsWith("ftp-limited-scan")),
    ).toBe(true);
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
    expect(mockSafeFetch).not.toHaveBeenCalled();
  });

  it("scans only as many URLs as remain in the daily quota and marks the rest skipped without scanning them", async () => {
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
    expect(json.skipped).toBe(1);
    expect(json.results[2]).toEqual(
      expect.objectContaining({
        url: "https://three.example.com/",
        success: false,
        error: expect.stringMatching(/Daily scan limit reached/),
      }),
    );
    // 2 successful scans x 2 calls each: the page fetch, plus the async
    // bucket-listing check's own follow-up homepage fetch.
    expect(mockSafeFetch).toHaveBeenCalledTimes(4);
    expect(mockIncrementDailyCount).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v3/scan/bulk - API key per-URL rate limiting", () => {
  it("stops scanning and marks the remaining URLs failed once the API key's per-URL limit is hit mid-batch", async () => {
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
      }) // early check
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
    expect(json.successful).toBe(1);
    expect(json.failed).toBe(2);
    expect(json.results[0].success).toBe(true);
    expect(json.results[1]).toEqual(
      expect.objectContaining({
        success: false,
        error: "API key daily limit reached mid-scan.",
      }),
    );
    expect(json.results[2]).toEqual(
      expect.objectContaining({
        success: false,
        error: "API key daily limit reached mid-scan.",
      }),
    );
    // Only the first URL was actually fetched - the loop broke before
    // url2/url3. That one successful scan makes 2 calls: the page fetch,
    // plus the async bucket-listing check's own follow-up homepage fetch.
    expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
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
