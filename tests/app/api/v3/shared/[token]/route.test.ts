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
import { invalidateSettingsCache } from "@/lib/config/runtime-config";

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
  // getCachedSubdomainSnapshot() (lib/scanner/subdomain-cache.ts) reads its
  // cache-TTL setting via getSetting(), which caches the system_settings
  // table for 30s at module scope (lib/config/runtime-config.ts). That
  // module-level cache survives across `it()` blocks in this file, so
  // whichever test first reaches the Promise.all in the route would "warm"
  // it and silently change how many pool.query calls -- and in what order
  // -- every later test makes. Forcing a cold cache before each test keeps
  // that call sequence deterministic and independent of test order.
  invalidateSettingsCache();
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

  it("excludes an expired share link in SQL, so it 404s the same as a revoked one", async () => {
    const token = "1".repeat(64);
    // The WHERE clause itself filters out an expired row -- simulated here
    // by the mock returning no rows, exactly like a revoked/never-existed
    // token would.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json).toEqual({
      error: "Shared scan not found or link has been revoked",
    });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "AND (sh.share_expires_at IS NULL OR sh.share_expires_at > NOW())",
    );
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

  it("returns the full shared scan payload, including badges and tags", async () => {
    const token = "d".repeat(64);
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 99,
            url: "https://example.com",
            scanned_at: "2026-01-15T00:00:00.000Z",
            duration: 1200,
            summary: { total: 1 },
            findings: [{ severity: "low", title: "x" }],
            findings_count: 1,
            response_headers: { "x-frame-options": "DENY" },
            notes: "looks fine",
            user_id: 42,
            authenticated: true,
            result_meta: { checksRun: 42, dangerScore: 7 },
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
      // Cold-cache system_settings read inside getCachedSubdomainSnapshot's
      // getSetting("SUBDOMAIN_CACHE_TTL_HOURS") call -- no override row, so
      // it falls back to the registry default.
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          { tag: "XSS Risk", source: "auto" },
          { tag: "client-corp", source: "user" },
        ],
      })
      // No subdomain_cache row for this host.
      .mockResolvedValueOnce({ rows: [] });

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      scanId: 99,
      url: "https://example.com",
      scannedAt: "2026-01-15T00:00:00.000Z",
      duration: 1200,
      summary: { total: 1 },
      findings: [{ severity: "low", title: "x" }],
      responseHeaders: { "x-frame-options": "DENY" },
      notes: "looks fine",
      authenticated: true,
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
      tags: [
        { tag: "XSS Risk", source: "auto" },
        { tag: "client-corp", source: "user" },
      ],
      checksRun: 42,
      dangerScore: 7,
    });

    // 5 calls: scan lookup, badges, the getSetting() system_settings read
    // inside getCachedSubdomainSnapshot, tags, then the subdomain_cache
    // lookup itself (that last query only fires once getSetting's own
    // await chain resolves, so it lands after the tags call, not before).
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [badgeSql, badgeParams] = mockQuery.mock.calls[1];
    expect(badgeSql).toContain("WHERE ub.user_id = $1");
    expect(badgeParams).toEqual([42]);
    const [settingsSql] = mockQuery.mock.calls[2];
    expect(settingsSql).toContain("FROM system_settings");
    const [tagsSql, tagsParams] = mockQuery.mock.calls[3];
    expect(tagsSql).toContain("FROM scan_tags WHERE scan_id = $1");
    expect(tagsParams).toEqual([99]);
    const [cacheSql, cacheParams] = mockQuery.mock.calls[4];
    expect(cacheSql).toContain("FROM subdomain_cache");
    expect(cacheParams[0]).toBe("example.com");
  });

  it("includes a cached subdomain snapshot when one exists for the scan's host", async () => {
    const token = "d1".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 21,
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
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
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
    // scanned subdomain. It's the last of the 5 calls: it only fires once
    // getSetting()'s own await chain resolves, after badges/settings/tags.
    const [, cacheParams] = mockQuery.mock.calls[4];
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
            id: 3,
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
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache -- no row

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
    expect(json.authenticated).toBe(false);
    expect(json.tags).toEqual([]);
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
