/**
 * Route-level tests for POST (create/get) and DELETE (revoke) share tokens
 * at /api/v3/history/[id]/share.
 *
 * Access is: the scan owner, OR a team admin/owner acting on behalf of the
 * scan's owner (`role IN ('owner', 'admin')` is filtered in SQL, so a
 * viewer's team-role lookup comes back empty exactly like an unrelated
 * user's does). Anyone else gets a generic 404 -- the route intentionally
 * never leaks whether the scan exists via a 403.
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

const { POST, DELETE } = await import("@/app/api/v3/history/[id]/share/route");

function params(id = "55") {
  return { params: Promise.resolve({ id }) };
}

function postRequest() {
  return new NextRequest("http://localhost/api/v3/history/55/share", {
    method: "POST",
  });
}

function deleteRequest() {
  return new NextRequest("http://localhost/api/v3/history/55/share", {
    method: "DELETE",
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("POST /api/v3/history/[id]/share", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the scan doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(404);
  });

  it("returns the existing token without regenerating it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: "already-there", user_id: 7 }],
    });

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.token).toBe("already-there");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("generates and persists a new token for the owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.token).toBe("string");
    expect(json.token).toMatch(/^[0-9a-f]{64}$/);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE scan_history SET share_token = $1");
    expect(sqlParams).toEqual([json.token, "55"]);
  });

  it("lets a team admin create a share on behalf of the scan owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 99 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] }); // teamRoleCheck
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(postRequest(), params());

    expect(res.status).toBe(200);
    const [teamSql, teamParams] = mockQuery.mock.calls[1];
    expect(teamSql).toContain("role IN ('owner', 'admin')");
    expect(teamParams).toEqual([7, 99]);
  });

  it("blocks a team viewer -- the role filter in SQL means their lookup comes back empty, so it's 404", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 99 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // teamRoleCheck: viewer never matches owner/admin filter

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });

  it("gives a completely unrelated user a 404, not a 403 -- scan existence isn't leaked", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 99 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no team relationship at all

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });
});

describe("DELETE /api/v3/history/[id]/share", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 when the scan doesn't exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(404);
  });

  it("revokes the token for the owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE scan_history SET share_token = NULL");
    expect(sqlParams).toEqual(["55"]);
  });

  it("lets a team owner revoke on behalf of the scan owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
  });

  it("blocks a team viewer and an unrelated user alike with 404", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });
});
