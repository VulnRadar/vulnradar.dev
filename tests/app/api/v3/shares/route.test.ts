/**
 * Route-level tests for GET /api/v3/shares: lists the current user's own
 * shared scans (scan_history rows with a non-null share_token), and
 * reshapes each row's JSON columns into the client's expected shape.
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

const { GET } = await import("@/app/api/v3/shares/route");

function getRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v3/shares");
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
});

describe("GET /api/v3/shares", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Unauthorized");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the query to the session user's own shared scans", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $1 AND share_token IS NOT NULL");
    expect(params).toEqual([42]);
  });

  it("parses stringified JSON findings/summary columns and computes findingsCount", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com",
          scanned_at: "2024-01-01T00:00:00.000Z",
          share_token: "tok_1",
          summary: JSON.stringify({ score: 90 }),
          findings: JSON.stringify([{ id: "a" }, { id: "b" }]),
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.shares).toEqual([
      {
        id: 1,
        url: "https://example.com",
        scannedAt: "2024-01-01T00:00:00.000Z",
        token: "tok_1",
        summary: { score: 90 },
        findings: [{ id: "a" }, { id: "b" }],
        findingsCount: 2,
      },
    ]);
  });

  it("passes through already-parsed object columns without re-parsing them", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          url: "https://example.org",
          scanned_at: "2024-02-01T00:00:00.000Z",
          share_token: "tok_2",
          summary: { score: 50 },
          findings: [{ id: "c" }],
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.shares[0].summary).toEqual({ score: 50 });
    expect(json.shares[0].findings).toEqual([{ id: "c" }]);
    expect(json.shares[0].findingsCount).toBe(1);
  });

  it("defaults findings to an empty array when the column is null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 3,
          url: "https://example.net",
          scanned_at: "2024-03-01T00:00:00.000Z",
          share_token: "tok_3",
          summary: null,
          findings: null,
        },
      ],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(json.shares[0].findings).toEqual([]);
    expect(json.shares[0].findingsCount).toBe(0);
    expect(json.shares[0].summary).toBeNull();
  });
});
