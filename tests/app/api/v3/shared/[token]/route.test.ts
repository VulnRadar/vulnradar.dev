/**
 * Route-level tests for GET /api/v3/shared/[token].
 *
 * This is the fuller data endpoint behind the public /shared/[token] page:
 * it returns findings, notes, and the scanning user's badges. Same token
 * validation and hashed-lookup rules as app/api/v3/badge/[token]/route.ts
 * apply here, so a not-found token must fail cleanly with no partial data.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { GET } = await import("@/app/api/v3/shared/[token]/route");

function makeRequest() {
  return new NextRequest("http://localhost/api/v3/shared/token");
}

function callGet(token: string) {
  return GET(makeRequest(), { params: Promise.resolve({ token }) });
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/v3/shared/[token]", () => {
  it("rejects an empty token with 400 before querying the database", async () => {
    const res = await callGet("");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Invalid share link" });
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

  it("looks up by the SHA-256 hash of the token, never the plaintext", async () => {
    const token = "b".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("share_token_hash = $1");
    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(params).toEqual([expectedHash]);
    expect(params[0]).not.toBe(token);
  });

  it("returns a clean 404 with no partial data when the token is not found", async () => {
    const token = "c".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({
      error: "Shared scan not found or link has been revoked",
    });
    // The badges lookup must not fire once the scan itself was not found.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns the full shared scan payload, including badges from the second query", async () => {
    const token = "d".repeat(64);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            url: "https://example.com",
            scanned_at: "2026-01-15T00:00:00.000Z",
            duration: 1200,
            summary: { total: 1 },
            findings: [{ severity: "low", title: "x" }],
            findings_count: 1,
            response_headers: { "x-frame-options": "DENY" },
            notes: "looks fine",
            user_id: 42,
            scanned_by: "Alice",
            scanned_by_avatar: "https://example.com/a.png",
            scanned_by_role: "admin",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: "verified",
            display_name: "Verified",
            icon: "check",
            color: "#22c55e",
            priority: 10,
          },
        ],
      })
      // No subdomain_cache row for this host.
      .mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      url: "https://example.com",
      scannedAt: "2026-01-15T00:00:00.000Z",
      duration: 1200,
      summary: { total: 1 },
      findings: [{ severity: "low", title: "x" }],
      responseHeaders: { "x-frame-options": "DENY" },
      notes: "looks fine",
      scannedBy: "Alice",
      scannedByAvatar: "https://example.com/a.png",
      scannedByRole: "admin",
      scannedByBadges: [
        {
          id: 1,
          name: "verified",
          display_name: "Verified",
          icon: "check",
          color: "#22c55e",
          priority: 10,
        },
      ],
      subdomainCache: null,
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [badgeSql, badgeParams] = mockQuery.mock.calls[1];
    expect(badgeSql).toContain("WHERE ub.user_id = $1");
    expect(badgeParams).toEqual([42]);
    const [cacheSql, cacheParams] = mockQuery.mock.calls[2];
    expect(cacheSql).toContain("FROM subdomain_cache");
    expect(cacheParams[0]).toBe("example.com");
  });

  it("includes a cached subdomain snapshot when one exists for the scan's host", async () => {
    const token = "d1".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            url: "https://shop.example.com",
            scanned_at: "2026-01-15T00:00:00.000Z",
            duration: 900,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 5,
            scanned_by: "Bob",
            scanned_by_avatar: null,
            scanned_by_role: "user",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            subdomains: [
              {
                subdomain: "api.example.com",
                url: "https://api.example.com",
                reachable: true,
                statusCode: 200,
                sources: ["crt.sh"],
              },
              {
                subdomain: "old.example.com",
                url: "https://old.example.com",
                reachable: false,
                sources: ["crt.sh"],
              },
            ],
            cached_at: "2026-08-08T00:00:00.000Z",
            expires_at: "2026-08-08T04:00:00.000Z",
          },
        ],
      });

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const json = await res.json();
    // The cache row is keyed off the scan's root domain, not the exact
    // scanned subdomain.
    const [, cacheParams] = mockQuery.mock.calls[2];
    expect(cacheParams[0]).toBe("example.com");
    expect(json.subdomainCache).toEqual({
      domain: "example.com",
      total: 2,
      reachable: 1,
      cached: true,
      cachedAt: "2026-08-08T00:00:00.000Z",
      expiresAt: "2026-08-08T04:00:00.000Z",
      subdomains: [
        {
          subdomain: "api.example.com",
          url: "https://api.example.com",
          reachable: true,
          statusCode: 200,
          sources: ["crt.sh"],
        },
        {
          subdomain: "old.example.com",
          url: "https://old.example.com",
          reachable: false,
          sources: ["crt.sh"],
        },
      ],
    });
  });

  it("falls back to defaults for missing optional fields", async () => {
    const token = "e".repeat(64);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            url: "https://example.com",
            scanned_at: "2026-01-15T00:00:00.000Z",
            duration: 500,
            summary: {},
            findings: null,
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 7,
            scanned_by: null,
            scanned_by_avatar: null,
            scanned_by_role: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    const json = await res.json();
    expect(json.findings).toEqual([]);
    expect(json.responseHeaders).toBeUndefined();
    expect(json.notes).toBe("");
    expect(json.scannedBy).toBe("Anonymous");
    expect(json.scannedByAvatar).toBeNull();
    expect(json.scannedByRole).toBe("user");
    expect(json.scannedByBadges).toEqual([]);
    expect(json.subdomainCache).toBeNull();
  });

  it("returns a 500 through withErrorHandling when the database query throws", async () => {
    const token = "f".repeat(64);
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    const res = await callGet(token);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({
      error: "An unexpected error occurred",
      status: 500,
    });
  });
});
