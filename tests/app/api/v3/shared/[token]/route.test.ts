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
    // Miss on the per-scan share_token_hash lookup falls through to the
    // host_badges lookup -- mock both.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await callGet(token);

    expect(mockQuery).toHaveBeenCalledTimes(2);
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
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_badges fallback miss

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

  it("returns a clean 404 with no partial data when the token matches neither a share link nor a site badge", async () => {
    const token = "c".repeat(64);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_badges fallback miss

    const res = await callGet(token);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json).toEqual({
      error: "Shared scan not found or link has been revoked",
    });
    // The badges lookup must not fire once the scan itself was not found.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("falls back to the host_badges lookup when no per-scan share token matches", async () => {
    const token = "6".repeat(64);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // share_token_hash miss
      .mockResolvedValueOnce({
        rows: [
          {
            id: 55,
            url: "https://example.com",
            scanned_at: "2026-02-01T00:00:00.000Z",
            duration: 800,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 42,
            scanned_by: "Alice",
            scanned_by_avatar: null,
            scanned_by_role: "user",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const [hostBadgeSql, hostBadgeParams] = mockQuery.mock.calls[1];
    expect(hostBadgeSql).toContain("FROM host_badges hb");
    expect(hostBadgeSql).toContain("badge_token_hash = $1");
    expect(hostBadgeSql).toContain("sh.status = 'completed'");
    expect(hostBadgeSql).toContain(
      "(sh.user_id = hb.user_id OR (hb.scope = 'global' AND sh.is_public = true))",
    );
    const expectedHash = createHash("sha256").update(token).digest("hex");
    expect(hostBadgeParams).toEqual([expectedHash]);
    const json = await res.json();
    expect(json.scanId).toBe(55);
  });

  it("redacts notes and identity for a scan resolved via a global-scope badge that belongs to someone else", async () => {
    const token = "7".repeat(64);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // share_token_hash miss
      .mockResolvedValueOnce({
        rows: [
          {
            id: 61,
            url: "https://example.com",
            scanned_at: "2026-03-01T00:00:00.000Z",
            duration: 700,
            summary: {},
            findings: [{ severity: "high", title: "y" }],
            findings_count: 1,
            response_headers: null,
            notes: "internal note about our client",
            user_id: 99, // the scan belongs to user 99...
            authenticated: false,
            result_meta: {},
            scanned_by: "Stranger",
            scanned_by_avatar: "https://example.com/s.png",
            scanned_by_role: "user",
            badge_owner_id: 42, // ...but the badge belongs to user 42
          },
        ],
      })
      // Platform-badges lookup must be skipped entirely for a foreign scan.
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.notes).toBe("");
    expect(json.scannedBy).toBe("Community scan");
    expect(json.scannedByAvatar).toBeNull();
    expect(json.scannedByRole).toBe("user");
    expect(json.scannedByBadges).toEqual([]);
    // The findings themselves -- the actual point of the badge -- still show.
    expect(json.findings).toEqual([{ severity: "high", title: "y" }]);
    // 5 real queries (share_token_hash miss, host_badges hit, settings,
    // tags, subdomain_cache): the platform-badges query is skipped
    // entirely for a foreign scan, not just ignored -- there's no extra
    // pool.query call to account for it.
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it("does not redact when the resolved scan belongs to the badge owner themselves", async () => {
    const token = "8".repeat(64);
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // share_token_hash miss
      .mockResolvedValueOnce({
        rows: [
          {
            id: 62,
            url: "https://example.com",
            scanned_at: "2026-03-01T00:00:00.000Z",
            duration: 700,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: "my own note",
            user_id: 42,
            authenticated: false,
            result_meta: {},
            scanned_by: "Alice",
            scanned_by_avatar: null,
            scanned_by_role: "user",
            badge_owner_id: 42, // same as user_id -- not a foreign scan
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);

    const json = await res.json();
    expect(json.notes).toBe("my own note");
    expect(json.scannedBy).toBe("Alice");
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

  it("publishes result_meta by name, dropping the keys the report does not render", async () => {
    // The response used to be `...meta`, which is not an allowlist: whatever
    // result_meta happened to carry reached anyone holding the link.
    const token = "a1".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 120,
            url: "https://example.com/login",
            scanned_at: "2026-04-01T00:00:00.000Z",
            duration: 400,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 8,
            authenticated: false,
            result_meta: {
              checksRun: 310,
              dangerScore: 4,
              sslGrade: "A",
              // Not part of the report: an operator signal, the login
              // outcome of an authenticated run, and a live-progress
              // leftover.
              checksErrored: 2,
              authReport: { status: "lost", method: "form", reason: "why" },
              partialFindings: [{ severity: "high", title: "mid-scan" }],
            },
            scanned_by: "Alice",
            scanned_by_avatar: null,
            scanned_by_role: "user",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);
    const json = await res.json();

    expect(json.checksRun).toBe(310);
    expect(json.dangerScore).toBe(4);
    expect(json.sslGrade).toBe("A");
    expect(json).not.toHaveProperty("checksErrored");
    expect(json).not.toHaveProperty("authReport");
    expect(json).not.toHaveProperty("partialFindings");
  });

  it("strips the internal per-page scan ids out of a shared crawl result", async () => {
    // crawl.pages[].scanHistoryId is the primary key of the owner's other
    // scan_history rows. components/scanner/crawl-pages-info.tsx never reads
    // it; it only ever reached the response because the object was spread.
    const token = "a2".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 130,
            url: "https://example.com",
            scanned_at: "2026-04-02T00:00:00.000Z",
            duration: 9000,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 8,
            authenticated: false,
            result_meta: {
              crawl: {
                pagesDiscovered: 2,
                pagesScanned: 2,
                pagesSkipped: 0,
                pages: [
                  {
                    url: "https://example.com/",
                    scanHistoryId: 4411,
                    findings: [],
                    findings_count: 0,
                    summary: { total: 0 },
                    duration: 500,
                  },
                  {
                    url: "https://example.com/about",
                    scanHistoryId: 4412,
                    findings: [{ severity: "low", title: "z" }],
                    findings_count: 1,
                    summary: { total: 1 },
                    duration: 600,
                  },
                ],
              },
            },
            scanned_by: "Alice",
            scanned_by_avatar: null,
            scanned_by_role: "user",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);
    const json = await res.json();

    expect(json.crawl.pagesDiscovered).toBe(2);
    expect(json.crawl.pages).toHaveLength(2);
    for (const page of json.crawl.pages) {
      expect(page).not.toHaveProperty("scanHistoryId");
    }
    // The fields the panel actually renders survive intact.
    expect(json.crawl.pages[1]).toEqual({
      url: "https://example.com/about",
      findings: [{ severity: "low", title: "z" }],
      findings_count: 1,
      summary: { total: 1 },
      duration: 600,
    });
  });

  it("keeps the redirect warning on the owner's own share link", async () => {
    // scan-result-detail.tsx renders this banner, and the owner saw it on
    // their own report before choosing to share the scan.
    const token = "a3".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 140,
            url: "https://app.example.com/login",
            scanned_at: "2026-04-03T00:00:00.000Z",
            duration: 400,
            summary: {},
            findings: [],
            findings_count: 0,
            response_headers: null,
            notes: null,
            user_id: 8,
            authenticated: false,
            result_meta: {
              redirect: {
                requestedUrl: "https://app.example.com/invite?token=SECRET",
                finalUrl: "https://app.example.com/login",
                kind: "login",
                reason: "redirected to a login page",
              },
            },
            scanned_by: "Alice",
            scanned_by_avatar: null,
            scanned_by_role: "user",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // badges
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);
    const json = await res.json();

    expect(json.redirect.requestedUrl).toBe(
      "https://app.example.com/invite?token=SECRET",
    );
  });

  it("drops the redirect warning for a foreign scan pulled in by a global badge", async () => {
    // scan_history.url is rewritten to the redirect target, so
    // redirect.requestedUrl is the only surviving copy of what that other
    // user typed -- an invite or password-reset link with its token still
    // attached. They never consented to a stranger's badge republishing it.
    const token = "a4".padEnd(64, "0");
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // share_token_hash miss
      .mockResolvedValueOnce({
        rows: [
          {
            id: 150,
            url: "https://app.example.com/login",
            scanned_at: "2026-04-04T00:00:00.000Z",
            duration: 400,
            summary: {},
            findings: [{ severity: "high", title: "y" }],
            findings_count: 1,
            response_headers: null,
            notes: "internal",
            user_id: 99, // the scan belongs to user 99...
            authenticated: false,
            result_meta: {
              checksRun: 310,
              redirect: {
                requestedUrl: "https://app.example.com/invite?token=SECRET",
                finalUrl: "https://app.example.com/login",
                kind: "login",
                reason: "redirected to a login page",
              },
            },
            scanned_by: "Stranger",
            scanned_by_avatar: null,
            scanned_by_role: "user",
            badge_owner_id: 42, // ...but the badge belongs to user 42
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // getSetting()'s system_settings read
      .mockResolvedValueOnce({ rows: [] }) // tags
      .mockResolvedValueOnce({ rows: [] }); // subdomain_cache

    const res = await callGet(token);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).not.toHaveProperty("redirect");
    expect(JSON.stringify(json)).not.toContain("SECRET");
    // The findings, which are the whole point of the badge, still show.
    expect(json.checksRun).toBe(310);
    expect(json.findings).toEqual([{ severity: "high", title: "y" }]);
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
