/**
 * Route-level tests for POST /api/v3/scan/verify (AI re-verification of a
 * scan's existing findings). The DB and session boundary are mocked, and
 * runAiVerification (lib/ai/verify-findings.ts) is mocked outright since it
 * is itself an LLM network boundary, the same category as fetch.
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

const mockRunAiVerification = vi.fn();
vi.mock("@/lib/ai/verify-findings", () => ({
  runAiVerification: (...args: unknown[]) => mockRunAiVerification(...args),
}));

const { POST } = await import("@/app/api/v3/scan/verify/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockRunAiVerification.mockReset();
  mockRunAiVerification.mockResolvedValue(undefined);
});

describe("POST /api/v3/scan/verify: auth and validation", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ scanHistoryId: 1 }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/v3/scan/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a missing or non-numeric scanHistoryId", async () => {
    const res = await POST(postRequest({ scanHistoryId: "abc" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/verify: AI-disabled setting", () => {
  it("returns 403 without fetching the scan when AI is disabled for the user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_disabled: true }] });

    const res = await POST(postRequest({ scanHistoryId: 10 }));
    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockRunAiVerification).not.toHaveBeenCalled();
  });

  it("treats a missing config row as AI enabled by default", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // no ai config row
      .mockResolvedValueOnce({
        rows: [{ url: "https://example.com", findings: [] }],
      })
      .mockResolvedValueOnce({ rows: [{ findings: [] }] });

    const res = await POST(postRequest({ scanHistoryId: 10 }));
    expect(res.status).toBe(200);
  });

  it("treats a failure reading the AI config as AI enabled by default", async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("config query failed"))
      .mockResolvedValueOnce({
        rows: [{ url: "https://example.com", findings: [] }],
      })
      .mockResolvedValueOnce({ rows: [{ findings: [] }] });

    const res = await POST(postRequest({ scanHistoryId: 10 }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/scan/verify: scan ownership and verification", () => {
  it("scopes the scan lookup to the session user and returns 404 when not found", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({ rows: [] }); // scan lookup: not found / not owned

    const res = await POST(postRequest({ scanHistoryId: 999 }));
    expect(res.status).toBe(404);
    expect(mockRunAiVerification).not.toHaveBeenCalled();

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE id = $1 AND user_id = $2");
    expect(params).toEqual([999, 42]);
  });

  it("runs verification against the fetched findings and returns the updated set", async () => {
    const findings = [{ id: "f1", title: "Missing CSP" }];
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // ai config: none
      .mockResolvedValueOnce({
        rows: [{ url: "https://example.com", findings }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            findings: [
              { id: "f1", title: "Missing CSP", aiVerdict: "confirmed" },
            ],
          },
        ],
      });

    const res = await POST(postRequest({ scanHistoryId: 10 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.findings[0].aiVerdict).toBe("confirmed");

    expect(mockRunAiVerification).toHaveBeenCalledWith(
      "https://example.com",
      findings,
      10,
      42,
    );
  });

  it("treats non-array findings from the DB as an empty list", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ url: "https://example.com", findings: null }],
      })
      .mockResolvedValueOnce({ rows: [{ findings: null }] });

    const res = await POST(postRequest({ scanHistoryId: 10 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // updated.rows[0].findings is null, so the route falls back to
    // parsedFindings ([]) rather than returning null.
    expect(json.findings).toEqual([]);
    expect(mockRunAiVerification).toHaveBeenCalledWith(
      "https://example.com",
      [],
      10,
      42,
    );
  });

  it("does not catch a failure from the AI verification call: it propagates uncontrolled", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ url: "https://example.com", findings: [] }],
    });
    mockRunAiVerification.mockRejectedValueOnce(new Error("AI provider down"));

    await expect(POST(postRequest({ scanHistoryId: 10 }))).rejects.toThrow(
      "AI provider down",
    );
  });
});
