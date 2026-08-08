/**
 * Route-level tests for /api/v3/scan/feedback (POST records a verdict on a
 * finding, GET reads it back). zod validation is real (a pure library); only
 * the DB and session boundary are mocked.
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

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
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
    ["non-integer scanHistoryId", { scanHistoryId: 1.5 }],
    ["non-positive scanHistoryId", { scanHistoryId: 0 }],
  ])("rejects payload with %s (400, no DB call)", async (_label, override) => {
    const res = await POST(postRequest(validPayload(override)));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid request");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("inserts feedback scoped to the session user and returns it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, verdict: "confirmed", created_at: "2026-01-01" }],
    });

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.feedback.verdict).toBe("confirmed");

    const [sql, params] = mockQuery.mock.calls[0];
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

  it("defaults scanHistoryId and notes to null when omitted", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 2, verdict: "false_positive", created_at: "2026-01-01" }],
    });

    await POST(
      postRequest(validPayload({ scanHistoryId: undefined, notes: undefined })),
    );

    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBeNull();
    expect(params[5]).toBeNull();
  });

  it("does not verify that scanHistoryId belongs to the session user before inserting", async () => {
    // No prior SELECT against scan_history is issued anywhere in this route:
    // a caller can attach feedback to any scanHistoryId, including one that
    // belongs to a different account. This test documents that behavior.
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, verdict: "confirmed", created_at: "2026-01-01" }],
    });

    const res = await POST(
      postRequest(validPayload({ scanHistoryId: 999999 })),
    );

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/SELECT.*scan_history/is);
    expect(params[1]).toBe(999999);
  });

  it("returns 503 when the feedback table has not been migrated yet", async () => {
    mockQuery.mockRejectedValueOnce(
      new Error('relation "scan_finding_feedback" does not exist'),
    );

    const res = await POST(postRequest(validPayload()));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain("migrate");
  });

  it("returns 500 on an unrelated database error", async () => {
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
