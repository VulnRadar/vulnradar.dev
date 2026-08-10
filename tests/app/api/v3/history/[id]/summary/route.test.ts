/**
 * Route-level tests for POST /api/v3/history/[id]/summary (on-demand
 * scan-level AI summary). The DB and session boundary are mocked, and
 * generateScanSummary (lib/ai/scan-summary.ts) is mocked outright since it
 * is itself an LLM network boundary -- same approach
 * tests/app/api/v3/scan/verify/route.test.ts uses for runAiVerification.
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

const mockGenerateScanSummary = vi.fn();
vi.mock("@/lib/ai/scan-summary", () => ({
  generateScanSummary: (...args: unknown[]) => mockGenerateScanSummary(...args),
}));

const { POST } = await import("@/app/api/v3/history/[id]/summary/route");

function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

function postRequest(id = "10") {
  return new NextRequest(`http://localhost/api/v3/history/${id}/summary`, {
    method: "POST",
  });
}

const scanRow = {
  url: "https://example.com",
  scanned_at: "2026-01-01T00:00:00.000Z",
  duration: 1200,
  findings: [{ id: "f1", title: "Missing CSP", severity: "high" }],
  summary: { critical: 0, high: 1, medium: 0, low: 0, info: 0, total: 1 },
  response_headers: {},
  result_meta: { dangerScore: 6 },
  authenticated: false,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGenerateScanSummary.mockReset();
  mockGenerateScanSummary.mockResolvedValue("A short plain-English summary.");
});

describe("POST /api/v3/history/[id]/summary: auth and validation", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockGenerateScanSummary).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric scan id", async () => {
    const res = await POST(postRequest("abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
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
    expect(sql).toContain("WHERE id = $1 AND user_id = $2");
    expect(sqlParams).toEqual([999, 42]);
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
    const [resultArg, userIdArg] = mockGenerateScanSummary.mock.calls[0];
    expect(resultArg.url).toBe("https://example.com");
    expect(resultArg.findings).toEqual(scanRow.findings);
    expect(resultArg.dangerScore).toBe(6);
    expect(userIdArg).toBe(42);

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
