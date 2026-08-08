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

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
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
  mockQuery.mockReset();
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
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: "free", role: "user" }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, url: "https://a.test" }],
    });

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scans).toEqual([{ id: 1, url: "https://a.test" }]);

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("sh.user_id = $1");
    expect(sql).toContain("sh.scanned_at > NOW()");
    expect(params).toEqual([7, 30]);
  });

  it("gives staff roles unlimited retention regardless of plan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", role: "admin" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("sh.user_id = $1");
    expect(sql).not.toContain("scanned_at >");
    expect(params).toEqual([7]);
  });

  it("gives unlimited retention for a plan whose retention is -1, independent of staff role", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", role: "user" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET(getRequest());

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).not.toContain("scanned_at >");
    expect(params).toEqual([7]);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ plan: "free", role: "user" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
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
});

describe("DELETE /api/v3/history", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("wipes only the caller's own scan tags and history", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toBe(SUCCESS_MESSAGES.DELETED);

    const [tagsSql, tagsParams] = mockQuery.mock.calls[0];
    expect(tagsSql).toContain("DELETE FROM scan_tags WHERE user_id = $1");
    expect(tagsParams).toEqual([7]);

    const [historySql, historyParams] = mockQuery.mock.calls[1];
    expect(historySql).toContain("DELETE FROM scan_history WHERE user_id = $1");
    expect(historyParams).toEqual([7]);
  });

  it("wipes the API key owner's history and records usage for Bearer auth", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 9,
      userId: 12,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
    );

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual([12]);
    expect(mockQuery.mock.calls[1][1]).toEqual([12]);
    expect(mockRecordUsage).toHaveBeenCalledWith(9);
  });
});
