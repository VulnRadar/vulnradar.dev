/**
 * Route-level tests for /api/v3/scan/feedback (POST records a verdict on a
 * finding, GET reads it back). zod validation is real (a pure library); only
 * the DB, the rate limiter and the session boundary are mocked.
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

// The limiter writes to rate_limits through the same pool; mocked at its own
// boundary so the pool mock below only ever answers the route's statements.
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Fire-and-forget from the route (never awaited), so left unmocked it
// would run for real against the same mocked pool above -- an extra,
// unconfigured pool.query() call racing every other test's own call-count
// assertions. Mocked here as a no-op; its own behavior is covered by
// lib/scanner/recompute-scan-score.test.ts.
const mockRecomputeScanScore = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/scanner/recompute-scan-score", () => ({
  recomputeScanScore: (...args: unknown[]) => mockRecomputeScanScore(...args),
}));

const { POST, GET } = await import("@/app/api/v3/scan/feedback/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost/api/v3/scan/feedback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: "GET" });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "csp-missing--example.com",
    findingUrl: "https://example.com/",
    scanHistoryId: 123,
    verdict: "confirmed",
    notes: "Confirmed by hand.",
    ...overrides,
  };
}

/** The ownership lookup, the finding-in-scan check, then the INSERT. */
function answerSavedVerdict(verdict = "confirmed", scanId = 123) {
  mockQuery
    .mockResolvedValueOnce({
      rows: [{ id: scanId, url: "https://example.com/" }],
    })
    .mockResolvedValueOnce({ rows: [{ present: 1 }] })
    .mockResolvedValueOnce({
      rows: [{ id: 1, verdict, created_at: "2026-01-01" }],
    });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 10,
    retryAfterSeconds: 0,
  });
  mockRecomputeScanScore.mockReset();
  mockRecomputeScanScore.mockResolvedValue(undefined);
});

describe("POST /api/v3/scan/feedback", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before touching the database", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["missing findingId", { findingId: undefined }],
    ["empty findingId", { findingId: "" }],
    ["findingId too long", { findingId: "x".repeat(201) }],
    ["malformed findingUrl", { findingUrl: "not-a-url" }],
    ["unknown verdict", { verdict: "maybe" }],
    ["notes too long", { notes: "x".repeat(1001) }],
    ["missing scanHistoryId", { scanHistoryId: undefined }],
    ["null scanHistoryId", { scanHistoryId: null }],
    ["non-integer scanHistoryId", { scanHistoryId: 1.5 }],
    ["non-positive scanHistoryId", { scanHistoryId: 0 }],
    ["scanHistoryId past int4", { scanHistoryId: 99999999999 }],
    ["scanHistoryId that is no kind of id", { scanHistoryId: "not-a-scan" }],
    ["upper case public id", { scanHistoryId: "A".repeat(32) }],
    ["object scanHistoryId", { scanHistoryId: { id: 1 } }],
  ])("rejects payload with %s (400, no DB call)", async (_label, override) => {
    const res = await POST(postRequest(validPayload(override)));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Every verdict feeds the per-check accuracy every other customer's scans
  // are discounted by, so an unbounded endpoint was a free way to script it.
  it("is rate limited per user, and writes nothing once the limit is spent", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const res = await POST(postRequest(validPayload()));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ key: "scan-feedback:42" }),
    );
  });

  // A verdict is only evidence about a check if it is about a finding the
  // check really produced. Without this, any finding id could be filed against
  // any of the caller's scans, and the accuracy table read it as a real one.
  it("refuses a findingId that is not in the referenced scan (400) and writes nothing", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 123, url: "https://example.com/" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      postRequest(validPayload({ findingId: "xss-reflected--made-up" })),
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("That finding is not in this scan.");
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [presenceSql, presenceParams] = mockQuery.mock.calls[1];
    expect(presenceSql).toContain("findings @>");
    expect(presenceParams).toEqual([123, "xss-reflected--made-up"]);
    expect(mockRecomputeScanScore).not.toHaveBeenCalled();
  });

  it("inserts feedback scoped to the session user and returns it", async () => {
    answerSavedVerdict();

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.feedback.verdict).toBe("confirmed");

    const [ownerSql, ownerParams] = mockQuery.mock.calls[0];
    expect(ownerSql).toContain("AND user_id = $3");
    expect(ownerParams).toEqual(["123", 123, 42]);

    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("INSERT INTO scan_finding_feedback");
    expect(params).toEqual([
      42,
      123,
      "csp-missing--example.com",
      "https://example.com/",
      "confirmed",
      "Confirmed by hand.",
    ]);
  });

  it("recomputes the scan's score after a successful save", async () => {
    answerSavedVerdict("false_positive");

    await POST(postRequest(validPayload({ verdict: "false_positive" })));

    expect(mockRecomputeScanScore).toHaveBeenCalledTimes(1);
    // The caller's id travels with the scan id: the recompute is scoped to
    // the caller's own row and decides from it whether the public
    // host_reputation row may follow (only for a verified owner of the host).
    expect(mockRecomputeScanScore).toHaveBeenCalledWith(123, 42);
  });

  it("still returns the saved feedback even if recompute fails in the background", async () => {
    answerSavedVerdict("false_positive");
    mockRecomputeScanScore.mockRejectedValueOnce(new Error("db exploded"));

    const res = await POST(
      postRequest(validPayload({ verdict: "false_positive" })),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("defaults notes to null when omitted", async () => {
    answerSavedVerdict();

    await POST(postRequest(validPayload({ notes: undefined })));

    const [, params] = mockQuery.mock.calls[2];
    expect(params[1]).toBe(123);
    expect(params[5]).toBeNull();
  });

  it("takes the public id History lists, and stores and recomputes by the numeric key", async () => {
    const publicId = "f".repeat(32);
    answerSavedVerdict();

    const res = await POST(
      postRequest(validPayload({ scanHistoryId: publicId })),
    );

    expect(res.status).toBe(200);
    const [ownerSql, ownerParams] = mockQuery.mock.calls[0];
    expect(ownerSql).toContain("public_id = $1");
    expect(ownerSql).toContain("AND user_id = $3");
    expect(ownerParams).toEqual([publicId, null, 42]);
    expect(mockQuery.mock.calls[2][1][1]).toBe(123);
    expect(mockRecomputeScanScore).toHaveBeenCalledWith(123, 42);
  });

  it("takes the numeric id as a string too", async () => {
    answerSavedVerdict();

    const res = await POST(postRequest(validPayload({ scanHistoryId: "123" })));

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(["123", 123, 42]);
  });

  it("404s a public id that is not the caller's, and writes nothing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(
      postRequest(validPayload({ scanHistoryId: "e".repeat(32) })),
    );

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRecomputeScanScore).not.toHaveBeenCalled();
  });

  it("404s and never inserts when scanHistoryId does not belong to the session user (AUDIT-010#security-02)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ownership check: no match

    const res = await POST(
      postRequest(validPayload({ scanHistoryId: 999999 })),
    );

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("AND user_id = $3");
    expect(params).toEqual(["999999", 999999, 42]);
    expect(mockRecomputeScanScore).not.toHaveBeenCalled();
  });

  it("returns 503 when the feedback table has not been migrated yet", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 123 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ present: 1 }] })
      .mockRejectedValueOnce(
        new Error('relation "scan_finding_feedback" does not exist'),
      );

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("migrate");
  });

  it("returns 500 on an unrelated database error", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 123 }] }) // ownership check
      .mockResolvedValueOnce({ rows: [{ present: 1 }] })
      .mockRejectedValueOnce(new Error("connection terminated"));

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(500);
  });

  it("returns 500 when the ownership check itself fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection terminated"));

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/v3/scan/feedback", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the read to the session user and returns feedback rows", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ finding_id: "csp-missing--example.com", verdict: "confirmed" }],
    });

    const res = await GET(
      getRequest({ url: "https://example.com/", findingId: "csp-missing" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.feedback).toHaveLength(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $1");
    expect(params[0]).toBe(42);
  });

  it("returns 500 on a database error", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await GET(getRequest());
    expect(res.status).toBe(500);
  });
});
