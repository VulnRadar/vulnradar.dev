/**
 * Route-level tests for GET/DELETE /api/v3/history.
 *
 * Both handlers support dual auth (Bearer API key or session cookie). The
 * API-key path mocks @/lib/api/api-keys outright: this route's job isn't to
 * prove ownership through api-keys.ts (see history/[id]/route.test.ts and
 * keys/**.test.ts for that), it's to prove the retention-window SQL is
 * correct: staff roles get unlimited retention (no date filter) while other
 * plans use BILLING_HISTORY_RETENTION[plan] with a dated WHERE clause, and
 * the query is always scoped to the caller's own user_id.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SUCCESS_MESSAGES } from "@/lib/config/constants";

// GET now also resolves the caller's plan retention setting live via
// lib/config/runtime-config's getSettings(), which issues its own
// pool.query("SELECT key, value FROM system_settings") ahead of the
// business queries below. That call is intercepted here so it doesn't
// consume a slot from mockBusinessQuery's mockResolvedValueOnce() queue and
// shift every other test's indices. By default it returns empty rows,
// meaning every setting resolves to its shipped default from
// lib/config/config-values.ts -- which, per the "keep history forever"
// decision, is now -1 (unlimited) for every plan's retention window, and
// 100 for HISTORY_LIST_MAX_ROWS. Tests that need a *dated* retention
// window (i.e. an admin has configured one away from the -1 default)
// populate `systemSettingsRows` before calling the handler.
let systemSettingsRows: Array<{ key: string; value: string }> = [];
const mockBusinessQuery = vi.fn();
const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  if (sql.trim().startsWith("SELECT key, value FROM system_settings")) {
    return { rows: systemSettingsRows };
  }
  return mockBusinessQuery(sql, params);
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...(args as [string, unknown[]?])),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockValidateApiKey = vi.fn();
const mockCheckApiKeyRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
}));

const { GET, DELETE } = await import("@/app/api/v3/history/route");

function getRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/history", {
    method: "GET",
    headers,
  });
}

function deleteRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/history", {
    method: "DELETE",
    headers,
  });
}

beforeEach(() => {
  systemSettingsRows = [];
  mockQuery.mockClear();
  mockBusinessQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockValidateApiKey.mockReset();
  mockCheckApiKeyRateLimit.mockReset();
  mockCheckApiKeyRateLimit.mockResolvedValue({
    allowed: true,
    limit: 50,
    used: 1,
    remaining: 49,
    resetsAt: new Date().toISOString(),
  });
  mockRecordUsage.mockReset();
});

describe("GET /api/v3/history", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("uses the free plan's dated retention window, scoped to the caller", async () => {
    // Shipped default for BILLING_FREE_RETENTION is now -1 (unlimited) --
    // exercise the dated-window branch the way an admin who dials the free
    // plan's retention back down to 30 days would, via system_settings.
    systemSettingsRows = [{ key: "BILLING_FREE_RETENTION", value: "30" }];
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ id: 1, url: "https://a.test" }],
    });
    // GET also asks for the true account total, so the client cannot present
    // the capped page size as the total (AUDIT-014#magic-02: the delete-all
    // confirmation understated what the unbounded DELETE actually removes).
    mockBusinessQuery.mockResolvedValueOnce({ rows: [{ n: 412 }] });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scans).toEqual([{ id: 1, url: "https://a.test" }]);
    expect(json.total).toBe(412);
    expect(json.truncated).toBe(true);

    const [sql, params] = mockBusinessQuery.mock.calls[1];
    expect(sql).toContain("sh.user_id = $1");
    expect(sql).toContain("sh.scanned_at > NOW()");
    expect(sql).toContain("sh.scan_type != 'github'");
    // [userId, retentionDays, limit, offset]. HISTORY_LIST_MAX_ROWS (100
    // shipped default) is the admin-configurable LIMIT, and the trailing 0 is
    // the OFFSET a request with no ?offset resolves to -- identical to the
    // pre-pagination behaviour.
    expect(params).toEqual([7, 30, 100, 0]);
  });

  it("exposes the opaque public_id as the id the client consumes, not the sequential primary key", async () => {
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ id: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4", url: "https://a.test" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    // The list SELECT aliases scan_history.public_id AS id, so the value the
    // client carries into ?scan= links and body-params is the opaque one.
    const [sql] = mockBusinessQuery.mock.calls[1];
    expect(sql).toContain("sh.public_id AS id");
    expect(json.scans[0].id).toBe("a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4");
  });

  it("gives staff roles unlimited retention regardless of plan", async () => {
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "admin" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [sql, params] = mockBusinessQuery.mock.calls[1];
    expect(sql).toContain("sh.user_id = $1");
    expect(sql).not.toContain("scanned_at >");
    // [userId, limit, offset] -- no date filter, so no retentionDays param.
    expect(params).toEqual([7, 100, 0]);
  });

  it("gives unlimited retention for a plan whose retention is -1, independent of staff role", async () => {
    // BILLING_PRO_SUPPORTER_RETENTION's shipped default is -1 (unlimited),
    // exercised here without any system_settings override.
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [sql, params] = mockBusinessQuery.mock.calls[1];
    expect(sql).not.toContain("scanned_at >");
    expect(params).toEqual([7, 100, 0]);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
  });

  // Pagination. Before this, the list was hard-capped at HISTORY_LIST_MAX_ROWS
  // and reported `truncated: true` with no way to ask for the next page: an
  // account with more scans than the cap simply could not reach the older ones
  // over the API. ref: AUDIT-015#api-01
  describe("pagination", () => {
    function primeOnePage(rows: unknown[], total: number) {
      mockBusinessQuery.mockResolvedValueOnce({
        rows: [{ plan: "free", role: "user" }],
      });
      mockBusinessQuery.mockResolvedValueOnce({ rows });
      mockBusinessQuery.mockResolvedValueOnce({ rows: [{ n: total }] });
    }

    function pagedRequest(query: string) {
      return new NextRequest(`http://localhost/api/v3/history?${query}`, {
        method: "GET",
      });
    }

    /**
     * The limit and offset are always the LAST two params, whichever retention
     * branch ran. Asserted as a tail rather than a whole array because
     * runtime-config memoizes settings for the life of the module, so a plan's
     * retention window here depends on what an earlier test in this file put
     * in system_settings, and that is not what these tests are about.
     */
    const paging = (params: unknown[]) => params.slice(-2);

    it("passes limit and offset through to the query and reports them back", async () => {
      primeOnePage([{ id: "a", url: "https://a.test" }], 412);

      const res = await GET(pagedRequest("limit=25&offset=50"));
      const json = await res.json();

      const [, params] = mockBusinessQuery.mock.calls[1];
      expect(paging(params as unknown[])).toEqual([25, 50]);
      expect(json.limit).toBe(25);
      expect(json.offset).toBe(50);
      expect(json.maxLimit).toBe(100);
      expect(json.total).toBe(412);
    });

    it("clamps a limit above the deployment cap instead of rejecting it", async () => {
      primeOnePage([], 5);

      const res = await GET(pagedRequest("limit=100000"));
      const json = await res.json();

      const [, params] = mockBusinessQuery.mock.calls[1];
      expect(paging(params as unknown[])).toEqual([100, 0]);
      expect(json.limit).toBe(100);
    });

    it("falls back to the full page for a limit that is zero, negative, or junk", async () => {
      for (const bad of ["0", "-5", "abc", ""]) {
        mockBusinessQuery.mockReset();
        primeOnePage([], 5);
        await GET(pagedRequest(`limit=${bad}`));
        const [, params] = mockBusinessQuery.mock.calls[1];
        expect(paging(params as unknown[]), `limit=${bad}`).toEqual([100, 0]);
      }
    });

    it("truncated means 'there are rows after this page', not 'the cap was hit'", async () => {
      // Last page: offset 100 + 43 rows returned == the 143 total, so there is
      // nothing after it even though a previous page was full.
      primeOnePage(new Array(43).fill({ id: "x" }), 143);

      const res = await GET(pagedRequest("offset=100"));
      const json = await res.json();

      expect(json.truncated).toBe(false);
    });

    it("still reports truncated on the first page when more rows follow", async () => {
      primeOnePage(new Array(100).fill({ id: "x" }), 143);

      const res = await GET(getRequest());
      const json = await res.json();

      expect(json.offset).toBe(0);
      expect(json.truncated).toBe(true);
    });
  });

  // A spent per-key quota answers the same way on a history read as it does on
  // POST /scan. It used to be a bare { error } with no Retry-After, so a client
  // could not write one retry path across the two. ref: AUDIT-015#api-02
  it("answers a spent API-key quota with Retry-After and the rate-limit headers", async () => {
    const resetsAt = new Date(Date.now() + 3600_000).toISOString();
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      limit: 50,
      used: 50,
      remaining: 0,
      resetsAt,
    });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("50");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe(resetsAt);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(json.limit).toBe(50);
    expect(json.used).toBe(50);
    expect(json.resets_at).toBe(resetsAt);
    expect(mockBusinessQuery).not.toHaveBeenCalled();
  });

  it("rejects an invalid or revoked API key", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const res = await GET(getRequest({ authorization: "Bearer vr_live_bad" }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("blocks an API key whose user hasn't accepted the latest terms", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: true,
    });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(403);
  });

  it("returns 429 when the API key's daily rate limit is exhausted", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockCheckApiKeyRateLimit.mockResolvedValue({
      allowed: false,
      resetsAt: new Date().toISOString(),
    });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an API key missing the scan:read scope, before touching the database", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:write"],
    });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("scan:read");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows an API key that has the scan:read scope", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:read"],
    });
    mockBusinessQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "user" }],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/v3/history", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("wipes only the caller's own scan tags and history, excluding GitHub repo scans", async () => {
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe(SUCCESS_MESSAGES.DELETED);

    const [tagsSql, tagsParams] = mockBusinessQuery.mock.calls[0];
    expect(tagsSql).toContain("DELETE FROM scan_tags WHERE user_id = $1");
    expect(tagsSql).toContain("scan_type != 'github'");
    expect(tagsParams).toEqual([7]);

    const [historySql, historyParams] = mockBusinessQuery.mock.calls[1];
    expect(historySql).toContain("DELETE FROM scan_history");
    expect(historySql).toContain("user_id = $1");
    expect(historySql).toContain("scan_type != 'github'");
    expect(historyParams).toEqual([7]);
  });

  it("wipes the API key owner's history and records usage for Bearer auth", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 12,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
    expect(mockBusinessQuery.mock.calls[0][1]).toEqual([12]);
    expect(mockBusinessQuery.mock.calls[1][1]).toEqual([12]);
    expect(mockRecordUsage).toHaveBeenCalledWith(9);
  });

  it("rejects an API key missing the scan:delete scope -- a scan:write+scan:read key cannot wipe history, before touching the database", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 12,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:write", "scan:read"],
    });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("scan:delete");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows an API key that has the scan:delete scope", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 12,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:delete"],
    });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });
    mockBusinessQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
  });
});
