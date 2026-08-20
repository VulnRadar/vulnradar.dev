/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/history/[id].
 *
 * GET allows access if the scan is the caller's own OR the caller shares a
 * team with the scan's owner (a team_members self-join); anyone else gets a
 * generic 404. PATCH and DELETE now SELECT the scan's user_id/team_id
 * first, then decide via getTeamResourceAccess (org isolation, AUDIT-010
 * #273) before the mutation, which itself is scoped by id alone since
 * access was already decided. @/lib/api/api-keys and
 * @/lib/auth/team-resource-access are mocked outright here -- the latter
 * has its own dedicated suite (tests/lib/auth/team-resource-access.test.ts);
 * this suite only needs to prove the ROUTE calls it correctly and reacts
 * to its result, not re-derive its internal logic.
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

const mockGetTeamResourceAccess = vi.fn();
const mockGetAssignableTeamIds = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getTeamResourceAccess: (...args: unknown[]) =>
    mockGetTeamResourceAccess(...args),
  getAssignableTeamIds: (...args: unknown[]) =>
    mockGetAssignableTeamIds(...args),
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
  mockGetTeamResourceAccess.mockReset();
  mockGetTeamResourceAccess.mockResolvedValue({
    canRead: true,
    canWrite: true,
  });
  mockGetAssignableTeamIds.mockReset();
  mockGetAssignableTeamIds.mockResolvedValue([]);
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
    // Resolved to the numeric primary key (55), not the raw param.
    expect(tagsParams).toEqual([55, 7]);
  });

  it("resolves an opaque public_id: matches on public_id with no numeric fallback", async () => {
    const publicId = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 7 })] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup

    const res = await GET(getRequest(), params(publicId));

    expect(res.status).toBe(200);
    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("public_id = $1");
    // Not all-digits, so the numeric fallback param is null.
    expect(sqlParams).toEqual([publicId, null]);
  });

  it("still resolves a legacy numeric id via the fallback so old /history/55 links keep opening", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [scanRow({ user_id: 7 })] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup

    const res = await GET(getRequest(), params("55"));

    expect(res.status).toBe(200);
    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("public_id = $1");
    expect(sql).toContain("id = $2");
    // The all-digits id populates the numeric fallback param.
    expect(sqlParams).toEqual(["55", 55]);
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

  it("returns the scan when team access grants read (scoped to the scan's team_id)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [scanRow({ user_id: 99, team_id: 3 })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup (owner's tags)
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    const res = await GET(getRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.userId).toBe(99);
    // Access is decided by the scan's own owner + team_id, not a "share any team" join.
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(7, 99, 3);
  });

  it("returns 404 for a scan that team access does not grant read (e.g. a private personal scan)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [scanRow({ user_id: 99, team_id: null })],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tags lookup
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });

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

  it("updates notes for the owner's own scan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    }); // SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, notes: "updated" }] }); // UPDATE

    const res = await PATCH(patchRequest({ notes: "updated" }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.notes).toBe("updated");
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(7, 7, null);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE id = $2");
    expect(sql).not.toContain("user_id");
    expect(sqlParams).toEqual(["updated", 55]);
  });

  it("returns 404 when the scan doesn't exist at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT

    const res = await PATCH(patchRequest({ notes: "hijack" }), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a caller with no relationship to someone else's scan gets 404, not a distinguishing 403", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: null }],
    }); // SELECT
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });

    const res = await PATCH(patchRequest({ notes: "hijack" }), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a caller with read-only access to someone else's scan gets an informative 403, not 404", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    }); // SELECT
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    const res = await PATCH(patchRequest({ notes: "hijack" }), params());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("permission");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a team member with write access can edit a team-assigned scan they don't own", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    }); // SELECT
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, notes: "updated" }] }); // UPDATE

    const res = await PATCH(patchRequest({ notes: "updated" }), params());

    expect(res.status).toBe(200);
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(7, 99, 4);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
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

  it("updates isPublic alone, without touching notes", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: false }],
    });

    const res = await PATCH(patchRequest({ isPublic: false }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.isPublic).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("is_public = $1");
    expect(sql).not.toContain("notes = ");
    expect(sql).toContain("WHERE id = $2");
    expect(sqlParams).toEqual([false, 55]);
  });

  it("updates notes and isPublic together in one query", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
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

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("notes = $1");
    expect(sql).toContain("is_public = $2");
    expect(sql).toContain("WHERE id = $3");
    expect(sqlParams).toEqual(["updated", false, 55]);
  });

  it("deletes the host_reputation row it sourced when flipped from public to private", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: false }],
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    const res = await PATCH(patchRequest({ isPublic: false }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [deleteSql, deleteParams] = mockQuery.mock.calls[2];
    expect(deleteSql).toContain("DELETE FROM host_reputation");
    expect(deleteSql).toContain("source_scan_id = $1");
    expect(deleteParams).toEqual([55]);
  });

  it("does not touch host_reputation when flipping from private back to public", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, notes: "", is_public: true }],
    });

    const res = await PATCH(patchRequest({ isPublic: true }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("does not touch host_reputation for a notes-only PATCH", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, notes: "updated" }] });

    const res = await PATCH(patchRequest({ notes: "updated" }), params());

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("a caller with no relationship to someone else's scan gets 404 on an isPublic PATCH", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: null }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });

    const res = await PATCH(patchRequest({ isPublic: false }), params());

    expect(res.status).toBe(404);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  describe("teamId assignment", () => {
    it("lets the owner assign the scan to a team they can manage_scans in", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, user_id: 7, team_id: null }],
      });
      mockGetAssignableTeamIds.mockResolvedValue([4, 9]);
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, notes: "", is_public: true, team_id: 4 }],
      });

      const res = await PATCH(patchRequest({ teamId: 4 }), params());
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.teamId).toBe(4);
      const [sql, sqlParams] = mockQuery.mock.calls[1];
      expect(sql).toContain("team_id = $1");
      expect(sqlParams).toEqual([4, 55]);
    });

    it("lets the owner unassign a scan's team with teamId: null", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, user_id: 7, team_id: 4 }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, notes: "", is_public: true, team_id: null }],
      });

      const res = await PATCH(patchRequest({ teamId: null }), params());

      expect(res.status).toBe(200);
      expect(mockGetAssignableTeamIds).not.toHaveBeenCalled();
    });

    it("rejects assigning to a team the caller cannot manage_scans in", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, user_id: 7, team_id: null }],
      });
      mockGetAssignableTeamIds.mockResolvedValue([9]);

      const res = await PATCH(patchRequest({ teamId: 4 }), params());
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("cannot assign");
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("rejects a team member (non-owner) trying to reassign someone else's scan, even with write access", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 55, user_id: 99, team_id: 4 }],
      });
      mockGetTeamResourceAccess.mockResolvedValue({
        canRead: true,
        canWrite: true,
      });

      const res = await PATCH(patchRequest({ teamId: 9 }), params());
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain("owner");
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });
});

describe("DELETE /api/v3/history/[id]", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("deletes the owner's own scan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    }); // SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_reputation purge
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] }); // scan_history DELETE

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(7, 7, null);

    // The reputation cache is purged first, then the scan row is deleted.
    const [repSql] = mockQuery.mock.calls[1];
    expect(repSql).toContain("DELETE FROM host_reputation");
    const [sql, sqlParams] = mockQuery.mock.calls[2];
    expect(sql).toContain("DELETE FROM scan_history");
    expect(sql).toContain("WHERE id = $1");
    expect(sqlParams).toEqual([55]);
  });

  it("returns 404 when the scan doesn't exist at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a caller with no relationship to someone else's scan gets 404, not a distinguishing 403", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: null }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: false,
      canWrite: false,
    });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a caller with read-only access to someone else's scan gets an informative 403, not 404", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain("permission");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("a team member with write access can delete a team-assigned scan they don't own", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: true,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_reputation purge
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] }); // scan_history DELETE

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
    expect(mockGetTeamResourceAccess).toHaveBeenCalledWith(7, 99, 4);
  });

  it("does not grant write on a super_admin-owned team-assigned scan even to an owner-role co-member", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    });
    mockGetTeamResourceAccess.mockResolvedValue({
      canRead: true,
      canWrite: false,
    });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("authenticates via a Bearer API key and records usage", async () => {
    mockValidateApiKey.mockResolvedValue({
      keyId: 3,
      userId: 7,
      dailyLimit: 50,
      needsTermsAcceptance: false,
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_reputation purge
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] }); // scan_history DELETE

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
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 7, team_id: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // host_reputation purge
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55 }] }); // scan_history DELETE

    const res = await DELETE(
      deleteRequest({ authorization: "Bearer vr_live_testkey" }),
      params(),
    );

    expect(res.status).toBe(200);
  });
});
