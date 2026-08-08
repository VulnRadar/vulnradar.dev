/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/history/[id].
 *
 * GET allows access if the scan is the caller's own OR the caller shares a
 * team with the scan's owner (a team_members self-join); anyone else gets a
 * generic 404. PATCH and DELETE are scoped in SQL (`WHERE id = $1 AND
 * user_id = $2`), so a non-owner's attempt must come back 404 without any
 * write actually landing. @/lib/api/api-keys is mocked outright here (dual
 * auth is exercised, but the ownership proof this suite cares about is the
 * scan_history SQL, not api-keys.ts internals).
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

const mockValidateApiKey = vi.fn();
const mockCheckApiKeyRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock("@/lib/api/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
  checkRateLimit: (...args: unknown[]) => mockCheckApiKeyRateLimit(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
}));

const { GET, PATCH, DELETE } = await import("@/app/api/v3/history/[id]/route");

function params(id = "55") {
  return { params: Promise.resolve({ id }) };
}

function getRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/history/55", {
    method: "GET",
    headers,
  });
}

function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/history/55", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function deleteRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v3/history/55", {
    method: "DELETE",
    headers,
  });
}

function scanRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    url: "https://example.com",
    summary: "ok",
    findings: [],
    findings_count: 0,
    duration: 100,
    scanned_at: new Date().toISOString(),
    user_id: 7,
    response_headers: null,
    notes: "",
    ...overrides,
  };
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

describe("GET /api/v3/history/[id]", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(getRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns the scan when it belongs to the caller, without a team lookup", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 7 })] });

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe("https://example.com");
    expect(json.userId).toBe(7);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns the scan when the caller shares a team with the owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 99 })] });
    mockQuery.mockResolvedValueOnce({ rows: [{ team_count: 1 }] });

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.userId).toBe(99);

    const [teamSql, teamParams] = mockQuery.mock.calls[1];
    expect(teamSql).toContain("team_members tm1");
    expect(teamParams).toEqual([7, 99]);
  });

  it("returns 404 for a scan that is neither owned nor shared via a team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 99 })] });
    mockQuery.mockResolvedValueOnce({ rows: [{ team_count: 0 }] });

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });

  it("returns 404 when the scan doesn't exist at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest(), params());

    expect(res.status).toBe(404);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 7 })] });

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_testkey" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
  });

  it("rejects an invalid API key before querying the database", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const res = await GET(
      getRequest({ authorization: "Bearer vr_live_bad" }),
      params(),
    );

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v3/history/[id]", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ notes: "hi" }), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-string notes body before touching the database", async () => {
    const res = await PATCH(patchRequest({ notes: 123 }), params());

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("updates notes for the owner's own scan, scoped in SQL", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "updated" }],
    });

    const res = await PATCH(patchRequest({ notes: "updated" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.notes).toBe("updated");

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE id = $2 AND user_id = $3");
    expect(sqlParams).toEqual(["updated", "55", 7]);
  });

  it("a non-owner's PATCH against someone else's scan returns 404 and never succeeds", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ notes: "hijack" }), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, notes: "x" }] });

    const res = await PATCH(
      patchRequest({ notes: "x" }, { authorization: "Bearer vr_live_testkey" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
  });
});

describe("DELETE /api/v3/history/[id]", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("deletes the owner's own scan, scoped in SQL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE id = $1 AND user_id = $2");
    expect(sqlParams).toEqual(["55", 7]);
  });

  it("a non-owner's DELETE against someone else's scan ID returns 404 and never succeeds", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockRecordUsage).toHaveBeenCalledWith(3);
  });
});
