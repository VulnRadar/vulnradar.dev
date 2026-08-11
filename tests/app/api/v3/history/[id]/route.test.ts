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

  it("returns the scan (with its tags) when it belongs to the caller, without a team lookup", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 7 })] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ tag: "Clean", source: "auto" }],
    }); // tags lookup

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.url).toBe("https://example.com");
    expect(json.userId).toBe(7);
    expect(json.isPublic).toBe(true);
    expect(json.tags).toEqual([{ tag: "Clean", source: "auto" }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);

    const [tagsSql, tagsParams] = mockQuery.mock.calls[1];
    expect(tagsSql).toContain(
      "FROM scan_tags WHERE scan_id = $1 AND user_id = $2",
    );
    expect(tagsParams).toEqual(["55", 7]);
  });

  it("reports isPublic false for a scan its owner marked private", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [scanRow({ user_id: 7, is_public: false })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isPublic).toBe(false);
  });

  it("returns the scan when the caller shares a team with the owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 99 })] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup (owner's tags)
    mockQuery.mockResolvedValueOnce({ rows: [{ team_count: 1 }] });

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.userId).toBe(99);

    const [teamSql, teamParams] = mockQuery.mock.calls[2];
    expect(teamSql).toContain("team_members tm1");
    expect(teamParams).toEqual([7, 99]);
  });

  it("returns 404 for a scan that is neither owned nor shared via a team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 99 })] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup
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
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup

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

  it("rejects an API key missing the scan:write scope, before touching the database", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:read"],
    });

    const res = await PATCH(
      patchRequest({ notes: "x" }, { authorization: "Bearer vr_live_testkey" }),
      params(),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("scan:write");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an empty body with nothing to update", async () => {
    const res = await PATCH(patchRequest({}), params());

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean isPublic body before touching the database", async () => {
    const res = await PATCH(patchRequest({ isPublic: "yes" }), params());

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("updates isPublic alone, scoped in SQL, without touching notes", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: false }],
    });

    const res = await PATCH(patchRequest({ isPublic: false }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isPublic).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("is_public = $1");
    expect(sql).not.toContain("notes = ");
    expect(sql).toContain("WHERE id = $2 AND user_id = $3");
    expect(sqlParams).toEqual([false, "55", 7]);
  });

  it("updates notes and isPublic together in one query", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "updated", is_public: false }],
    });

    const res = await PATCH(
      patchRequest({ notes: "updated", isPublic: false }),
      params(),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.notes).toBe("updated");
    expect(json.isPublic).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("notes = $1");
    expect(sql).toContain("is_public = $2");
    expect(sql).toContain("WHERE id = $3 AND user_id = $4");
    expect(sqlParams).toEqual(["updated", false, "55", 7]);
  });

  it("deletes the host_reputation row it sourced when flipped from public to private", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: false }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await PATCH(patchRequest({ isPublic: false }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [deleteSql, deleteParams] = mockQuery.mock.calls[1];
    expect(deleteSql).toContain("DELETE FROM host_reputation");
    expect(deleteSql).toContain("source_scan_id = $1");
    expect(deleteParams).toEqual(["55"]);
  });

  it("does not touch host_reputation when flipping from private back to public", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: true }],
    });

    const res = await PATCH(patchRequest({ isPublic: true }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does not touch host_reputation for a notes-only PATCH", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "updated" }],
    });

    const res = await PATCH(patchRequest({ notes: "updated" }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a non-owner's isPublic PATCH returns 404 and never deletes host_reputation", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ isPublic: false }), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
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

  it("rejects an API key missing the scan:delete scope, before touching the database", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:write", "scan:read"],
    });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
      params(),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("scan:delete");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("allows an API key that has the scan:delete scope", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
      scopes: ["scan:delete"],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
      params(),
    );

    expect(res.status).toBe(200);
  });
});
