/**
 * Route-level tests for POST /api/v3/history/[id]/summary (on-demand
 * scan-level AI summary). The DB and session boundary are mocked, and
 * generateScanSummary (lib/ai/scan-summary.ts) is mocked outright since it
 * is itself an LLM network boundary -- same approach
 * tests/app/api/v3/scan/verify/route.test.ts uses for runAiVerification.
 *
 * checkRateLimit is mocked at its module boundary (same reasoning as the
 * verify route test) since it is itself DB-backed and would otherwise
 * consume mockQuery call slots the call-count assertions below depend on.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const mockGenerateScanSummary = vi.fn();
vi.mock("@/lib/ai/scan-summary", () => ({
  generateScanSummary: (...args: unknown[]) => mockGenerateScanSummary(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

const mockCheckAiUsageQuota = vi.fn();
vi.mock("@/lib/billing/ai-usage", () => ({
  checkAiUsageQuota: (...args: unknown[]) => mockCheckAiUsageQuota(...args),
}));

const { POST } = await import("@/app/api/v3/history/[id]/summary/route");

function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

function postRequest(
  id = "10",
  query = "",
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    `http://localhost/api/v3/history/${id}/summary${query}`,
    { method: "POST", headers },
  );
}

const scanRow = {
  id: 10,
  url: "https://example.com",
  scanned_at: "2026-01-01T00:00:00.000Z",
  duration: 1200,
  findings: [{ id: "f1", title: "Missing CSP", severity: "high" }],
  summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 },
  response_headers: {},
  result_meta: { dangerScore: 6 },
  authenticated: false,
};

const scanRowWithCachedSummary = {
  ...scanRow,
  result_meta: { dangerScore: 6, aiSummary: "Cached from an earlier run." },
};

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockValidateApiKey.mockReset();
  mockGenerateScanSummary.mockReset();
  mockGenerateScanSummary.mockResolvedValue("A short plain-English summary.");
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockCheckAiUsageQuota.mockReset();
  mockCheckAiUsageQuota.mockResolvedValue({
    allowed: true,
    usingOwnAi: false,
    usedTokens: 0,
    limitTokens: 20_000,
  });
});

describe("POST /api/v3/history/[id]/summary: auth and validation", () => {
  it("requires session or API key authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
  });

  it("rejects an invalid API key", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue(null);

    const res = await POST(
      postRequest("10", "", { Authorization: "Bearer vr_live_bad" }),
      params(),
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid API key.");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an API key missing the scan:write scope", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({ userId: 77, scopes: ["scan:read"] });

    const res = await POST(
      postRequest("10", "", { Authorization: "Bearer vr_live_readonly" }),
      params(),
    );

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("authenticates via a valid API key and scopes the scan lookup to its userId", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateApiKey.mockResolvedValue({
      userId: 77,
      scopes: ["scan:write"],
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(
      postRequest("10", "", { Authorization: "Bearer vr_live_good" }),
      params(),
    );

    expect(res.status).toBe(200);
    const [, sqlParams] = mockQuery.mock.calls[1];
    // [publicIdParam, numericFallback, userId] -- a numeric id resolves via
    // the fallback, still scoped to the API key's own userId.
    expect(sqlParams).toEqual(["10", 10, 77]);
    expect(mockGenerateScanSummary).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com" }),
      77,
      false,
    );
  });

  it("treats a non-numeric id as an opaque public_id and 404s when it resolves to nothing", async () => {
    // No longer rejected up front: a non-numeric id is a valid public_id
    // shape, so the route proceeds and the scan lookup (scoped to the user)
    // simply finds nothing.
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [] }); // scan lookup by public_id: not found

    const res = await POST(postRequest("nope-nope"), params("nope-nope"));

    expect(res.status).toBe(404);
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("public_id = $1");
    // Not an all-digits id, so the numeric fallback param is null.
    expect(sqlParams).toEqual(["nope-nope", null, 42]);
  });
});

describe("POST /api/v3/history/[id]/summary: AI-disabled setting", () => {
  it("returns 403 without fetching the scan when AI is disabled for the user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
  });

  it("treats a missing config row as AI enabled by default", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no ai config row
      .mockResolvedValueOnce({ rows: [scanRow] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(200);
  });

  it("treats a failure reading the AI config as AI enabled by default", async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("config query failed"))
      .mockResolvedValueOnce({ rows: [scanRow] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/history/[id]/summary: scan ownership", () => {
  it("scopes the scan lookup to the session user and returns 404 when not found", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [] }); // scan lookup: not found / not owned

    const res = await POST(postRequest("999"), params("999"));

    expect(res.status).toBe(404);
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("public_id = $1");
    expect(sql).toContain("user_id = $3");
    expect(sqlParams).toEqual(["999", 999, 42]);
  });
});

describe("POST /api/v3/history/[id]/summary: cache short-circuit", () => {
  it("returns the cached summary without calling generateScanSummary or the rate limiter", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRowWithCachedSummary] }); // scan lookup

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.summary).toBe("Cached from an earlier run.");
    expect(json.cached).toBe(true);
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    // Only the ai-config check and the scan lookup ran -- no UPDATE, because
    // nothing was regenerated.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("regenerates when ?regenerate=true is passed even though a cached summary exists", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRowWithCachedSummary] }) // scan lookup
      .mockResolvedValueOnce({ rows: [] }); // UPDATE
    mockGenerateScanSummary.mockResolvedValueOnce("A brand new summary.");

    const res = await POST(postRequest("10", "?regenerate=true"), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary).toBe("A brand new summary.");
    expect(json.cached).toBeUndefined();
    expect(mockGenerateScanSummary).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);

    const [updateSql, updateParams] = mockQuery.mock.calls[2];
    expect(updateSql).toContain("result_meta = COALESCE");
    expect(JSON.parse(updateParams[0])).toEqual({
      aiSummary: "A brand new summary.",
    });
  });

  it("generates normally (and consumes the rate limit) when no cached summary exists yet", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] }) // scan lookup, no aiSummary in result_meta
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(200);
    expect(mockGenerateScanSummary).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "ai-summary:42" }),
    );
  });

  it('ignores ?regenerate=true when it isn\'t exactly "true"', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [scanRowWithCachedSummary] });

    const res = await POST(postRequest("10", "?regenerate=yes"), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cached).toBe(true);
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/history/[id]/summary: rate limiting", () => {
  it("returns 429 without calling generateScanSummary when the rate limit is exceeded", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] }); // scan lookup, no cached summary
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 90,
    });

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain("Too many AI summary requests");
    expect(json.error).toContain("2 minute(s)");
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
    // No UPDATE query beyond the ai-config check and scan lookup.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v3/history/[id]/summary: generation succeeds", () => {
  it("generates a summary, persists it into result_meta, and returns it", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] }) // scan lookup
      .mockResolvedValueOnce({ rows: [] }); // UPDATE result_meta

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.summary).toBe("A short plain-English summary.");

    // The ScanResult passed to generateScanSummary carries the finding data
    // and the result_meta fields (dangerScore) spread in.
    const [resultArg, userIdArg, usingOwnAiArg] =
      mockGenerateScanSummary.mock.calls[0];
    expect(resultArg.url).toBe("https://example.com");
    expect(resultArg.findings).toEqual(scanRow.findings);
    expect(resultArg.dangerScore).toBe(6);
    expect(userIdArg).toBe(42);
    expect(usingOwnAiArg).toBe(false);

    // Persistence merges into result_meta rather than overwriting it, and
    // is scoped to the scan's owner.
    const [updateSql, updateParams] = mockQuery.mock.calls[2];
    expect(updateSql).toContain(
      "result_meta = COALESCE(result_meta, '{}'::jsonb) || $1::jsonb",
    );
    expect(JSON.parse(updateParams[0])).toEqual({
      aiSummary: "A short plain-English summary.",
    });
    expect(updateParams[1]).toBe(10);
    expect(updateParams[2]).toBe(42);
  });

  it("treats non-array findings from the DB as an empty list when building the prompt input", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...scanRow, findings: null }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(200);
    const [resultArg] = mockGenerateScanSummary.mock.calls[0];
    expect(resultArg.findings).toEqual([]);
  });
});

describe("POST /api/v3/history/[id]/summary: generation fails", () => {
  it("returns 502 and does not write to result_meta when generateScanSummary returns null", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] }); // scan lookup
    mockGenerateScanSummary.mockResolvedValueOnce(null);

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(typeof json.error).toBe("string");
    // Only the ai-config check and the scan lookup ran -- no UPDATE call.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v3/history/[id]/summary: unified AI usage quota", () => {
  it("is free/unmetered: still calls generateScanSummary even when the quota reports not allowed", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [scanRow] }) // scan lookup
      .mockResolvedValueOnce({ rows: [] });
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: false,
      usingOwnAi: false,
      usedTokens: 20_000,
      limitTokens: 20_000,
      message: "You've used all your AI tokens for this window.",
    });

    const res = await POST(postRequest(), params());

    expect(res.status).not.toBe(429);
    expect(mockGenerateScanSummary).toHaveBeenCalled();
    expect(mockCheckAiUsageQuota).toHaveBeenCalledWith(42);
  });

  it("never checks the quota on a cache hit", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [scanRowWithCachedSummary] });

    const res = await POST(postRequest(), params());
    expect(res.status).toBe(200);
    expect(mockCheckAiUsageQuota).not.toHaveBeenCalled();
  });

  it("passes quota.usingOwnAi through to generateScanSummary", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [scanRow] })
      .mockResolvedValueOnce({ rows: [] });
    mockCheckAiUsageQuota.mockResolvedValue({
      allowed: true,
      usingOwnAi: true,
      usedTokens: 0,
      limitTokens: -1,
    });

    const res = await POST(postRequest(), params());
    expect(res.status).toBe(200);
    const [, , usingOwnAiArg] = mockGenerateScanSummary.mock.calls[0];
    expect(usingOwnAiArg).toBe(true);
  });
});
