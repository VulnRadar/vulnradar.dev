/**
 * Route-level tests for GET /api/v3/badge/[token]/stats.
 *
 * Unlike its two siblings (app/api/v3/badge/[token]/route.ts and
 * app/api/v3/shared/[token]/route.ts), this one looks up the share token by
 * the plaintext `share_token` column rather than the hashed
 * `share_token_hash` column. That discrepancy is asserted explicitly below
 * so a future migration to the hashed column doesn't silently change this
 * file's behavior without a test noticing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET } = await import("@/app/api/v3/badge/[token]/stats/route");

function makeRequest(url = "http://localhost:3000/api/v3/badge/token/stats") {
  return new NextRequest(url);
}

function callGet(token: string, url?: string) {
  return GET(makeRequest(url), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/v3/badge/[token]/stats", () => {
  it("rejects an empty token with 400 before querying the database", async () => {
    const res = await callGet("");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Invalid share token" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a short, malformed token with 400", async () => {
    const res = await callGet("short-token");

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a token one character short of 64", async () => {
    const res = await callGet("a".repeat(63));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a token one character over 64", async () => {
    const res = await callGet("a".repeat(65));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 for a valid-length token with no matching row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await callGet("b".repeat(64));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({ error: "Not found" });
  });

  it("looks up by the plaintext share_token column, not a hash", async () => {
    const token = "c".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("share_token = $1");
    expect(sql).not.toContain("share_token_hash");
    expect(params).toEqual([token]);
  });

  it("excludes an expired share link in SQL, the same way its sibling badge/share endpoints do", async () => {
    const token = "a1".padEnd(64, "0");
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())",
    );
  });

  it("returns stats JSON derived from the row, including URLs built from the request origin", async () => {
    const token = "d".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          findings: [],
          findings_count: 0,
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(
      token,
      "http://localhost:3000/api/v3/badge/x/stats",
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      safetyRating: "safe",
      issuesCount: 0,
      lastScanned: "2026-01-15T00:00:00.000Z",
      url: "https://example.com",
      shareUrl: `http://localhost:3000/shared/${token}`,
      badgeUrl: `http://localhost:3000/api/badge/${token}`,
    });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("falls back to an empty findings array when the column is null", async () => {
    const token = "f".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          findings: null,
          findings_count: 0,
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const json = await res.json();
    expect(json.safetyRating).toBe("safe");
  });

  it("parses findings stored as a JSON string when computing the safety rating", async () => {
    const token = "e".repeat(64);
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          url: "https://example.com",
          findings: JSON.stringify([
            { severity: "critical", title: "SQL Injection" },
          ]),
          findings_count: 1,
          scanned_at: "2026-01-15T00:00:00.000Z",
        },
      ],
    });

    const res = await callGet(token);

    const json = await res.json();
    expect(json.safetyRating).toBe("unsafe");
  });
});
