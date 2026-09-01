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

function postRequest(body?: unknown) {
  return new NextRequest("http://localhost/api/v3/history/55/share", {
    method: "POST",
    ...(body !== undefined
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
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

  it("generates and persists a new token for the owner, with no expiry by default", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });
    // resolveSharePubliclyListed's account-default lookup (scoped to the
    // scan owner, id 7), then the UPDATE.
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(typeof json.token).toBe("string");
    expect(json.token).toMatch(/^[0-9a-f]{64}$/);
    expect(json.expiresAt).toBeNull();
    expect(json.publiclyListed).toBe(true);

    const [resolverSql, resolverParams] = mockQuery.mock.calls[1];
    expect(resolverSql).toContain("share_publicly_listed_by_default");
    expect(resolverParams).toEqual([7]);

    const [sql, sqlParams] = mockQuery.mock.calls[2];
    expect(sql).toContain("UPDATE scan_history SET share_token = $1");
    expect(sql).toContain("share_publicly_listed = $3");
    expect(sqlParams).toEqual([json.token, null, true, 55]);
  });

  it("stores a computed expiry when expiresInDays is provided", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const before = Date.now();
    const res = await POST(postRequest({ expiresInDays: 30 }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.expiresAt).toEqual(expect.any(String));
    const expiresMs = new Date(json.expiresAt).getTime();
    expect(expiresMs).toBeGreaterThan(before + 29 * 86400000);
    expect(expiresMs).toBeLessThan(before + 31 * 86400000);

    const [, sqlParams] = mockQuery.mock.calls[2];
    expect(sqlParams).toEqual([json.token, json.expiresAt, true, 55]);
  });

  it("resolves publiclyListed to false when the scan owner's account default is off", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: false }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(json.publiclyListed).toBe(false);
    const [, sqlParams] = mockQuery.mock.calls[2];
    expect(sqlParams).toEqual([json.token, null, false, 55]);
  });

  it("honors an explicit publiclyListed override in the request body, skipping the account-default lookup", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE only -- no resolver lookup

    const res = await POST(postRequest({ publiclyListed: false }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.publiclyListed).toBe(false);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [, sqlParams] = mockQuery.mock.calls[1];
    expect(sqlParams).toEqual([json.token, null, false, 55]);
  });

  it("rejects a non-boolean publiclyListed value before touching the database", async () => {
    const res = await POST(postRequest({ publiclyListed: "yes" }), params());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/publiclyListed/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an expiresInDays value outside the allowed set", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 7 }],
    });

    const res = await POST(postRequest({ expiresInDays: 14 }), params());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/expiresInDays/);
    // Rejected before the ownership/select query ever runs.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("updates the expiry on an existing, non-expired token instead of rotating it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 55,
          share_token: "already-there",
          share_expires_at: null,
          share_publicly_listed: false,
          user_id: 7,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE share_expires_at

    const res = await POST(postRequest({ expiresInDays: 7 }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.token).toBe("already-there");
    expect(json.expiresAt).toEqual(expect.any(String));
    // The already-live branch must report the share's real current listing
    // state too, not just token/expiresAt -- the Share modal needs this to
    // show an accurate toggle instead of assuming every share is listed.
    expect(json.publiclyListed).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain(
      "UPDATE scan_history SET share_expires_at = $1 WHERE id = $2",
    );
    expect(sqlParams).toEqual([json.expiresAt, 55]);
  });

  it("applies publiclyListed to an existing live share instead of silently dropping it", async () => {
    // The field was validated at the top of the handler and then only used
    // when creating a brand-new share, so pressing Share again on an existing
    // link returned 200 with the OLD value while reporting success.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 55,
          share_token: "already-there",
          share_expires_at: null,
          share_publicly_listed: false,
          user_id: 7,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE share_publicly_listed

    const res = await POST(postRequest({ publiclyListed: true }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.publiclyListed).toBe(true);
    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE scan_history SET share_publicly_listed = $1");
    expect(sqlParams).toEqual([true, 55]);
  });

  it("leaves an existing share's listing state alone when publiclyListed is not sent", async () => {
    // An omitted field must not be re-resolved through the account default:
    // that would clobber a per-share choice made via
    // PUT .../share/publicly-listed just by pressing Share again.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 55,
          share_token: "already-there",
          share_expires_at: null,
          share_publicly_listed: false,
          user_id: 7,
        },
      ],
    });

    const res = await POST(postRequest({}), params());
    const json = await res.json();

    expect(json.publiclyListed).toBe(false);
    // No UPDATE at all: the select is the only query.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("clears an existing token's expiry when expiresInDays is explicitly null", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 55,
          share_token: "already-there",
          share_expires_at: "2099-01-01T00:00:00.000Z",
          user_id: 7,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ expiresInDays: null }), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.expiresAt).toBeNull();
    const [, sqlParams] = mockQuery.mock.calls[1];
    expect(sqlParams).toEqual([null, 55]);
  });

  it("issues a fresh token when the existing one has already expired, instead of resurrecting it", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 55,
          share_token: "stale-token",
          share_expires_at: "2020-01-01T00:00:00.000Z",
          user_id: 7,
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: true }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE share_token + share_expires_at + share_publicly_listed

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.token).not.toBe("stale-token");
    expect(json.token).toMatch(/^[0-9a-f]{64}$/);

    const [sql, sqlParams] = mockQuery.mock.calls[2];
    expect(sql).toContain("UPDATE scan_history SET share_token = $1");
    expect(sqlParams).toEqual([json.token, null, true, 55]);
  });

  it("lets a team admin create a share on behalf of the scan owner, resolving the listing default against the OWNER's account, not the admin's", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, share_token: null, user_id: 99, team_id: 4 }],
    }); // scan (team-assigned)
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 4 }] }); // getScanTeamIds: the scan's team set
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] }); // getScanTeamAccess: caller role across that set
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // getScanTeamAccess: owner role (not god-mode)
    mockQuery.mockResolvedValueOnce({
      rows: [{ share_publicly_listed_by_default: false }],
    }); // resolver, scoped to the scan owner (99), not the session admin (7)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(postRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    // Access is scoped to the teams the scan is actually shared with (4) plus
    // its owner (99), via getScanResourceAccess, not a "share any team"
    // self-join.
    const [teamSql, teamParams] = mockQuery.mock.calls[2];
    expect(teamSql).toContain(
      "FROM team_members WHERE user_id = $1 AND team_id = ANY($2::int[])",
    );
    expect(teamParams).toEqual([7, [4]]);

    const [resolverSql, resolverParams] = mockQuery.mock.calls[4];
    expect(resolverSql).toContain("share_publicly_listed_by_default");
    expect(resolverParams).toEqual([99]);
    expect(json.publiclyListed).toBe(false);
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
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, user_id: 7 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE scan_history SET share_token = NULL");
    expect(sqlParams).toEqual([55]);
  });

  it("lets a team owner revoke on behalf of the scan owner", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 55, user_id: 99, team_id: 4 }],
    }); // scan (team-assigned)
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 4 }] }); // getScanTeamIds: the scan's team set
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] }); // caller role across that set
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // owner role (not god-mode)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE share_token = NULL

    const res = await DELETE(deleteRequest(), params());

    expect(res.status).toBe(200);
  });

  it("blocks a team viewer and an unrelated user alike with 404", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 55, user_id: 99 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest(), params());
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Scan not found");
  });
});
