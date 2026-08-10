/**
 * Route-level tests for /api/v3/teams: GET (list the session user's teams),
 * POST (create a team, making the creator the owner), PATCH (rename, owner/
 * admin only), and DELETE (delete, owner only, cascading team_invites and
 * team_members first). The database is mocked at the pool boundary, same
 * pattern as tests/app/api/v3/teams/accept-invite/route.test.ts. POST also
 * uses pool.connect() for a transaction, so the mock exposes both query()
 * and connect().
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

// This route only calls getSession() from @/lib/auth, so mock the module
// outright rather than pulling in the real one (importOriginal), which
// transitively loads lib/config/registry.ts and other modules this suite
// doesn't need to exercise.
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

// getUserPlanLimits (lib/billing/plan-limits.ts) is real: only its two DB
// touch points are mocked. Default plan is elite_supporter (teams: 3),
// which reproduces every existing test's original unlimited-until-5
// assumption without changing them (all of them create with 0 existing
// teams, and 0 is under every paid tier's cap).
const mockGetSetting = vi.fn();
const mockGetFeatureTeams = vi.fn();
// getSettings resolves from the real registry defaults rather than
// hand-copied numbers, so these tests can't silently drift from what the
// registry actually ships.
async function resolveFromRegistry(keys: string[]) {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return Object.fromEntries(
    keys.map((k) => [
      k,
      SETTINGS_REGISTRY[k as keyof typeof SETTINGS_REGISTRY].default,
    ]),
  );
}
vi.mock("@/lib/config/runtime-config", () => ({
  // BILLING_ENABLED (read via getSetting inside getUserPlanLimits) and
  // FEATURE_TEAMS (the route's own deployment-wide kill switch) go through
  // controllable mocks; every other direct getSetting call
  // (MAX_TEAM_NAME_LENGTH) resolves from the real registry default like
  // getSettings does, so it can't silently drift from what the registry ships.
  getSetting: async (key: string) => {
    if (key === "BILLING_ENABLED") return mockGetSetting();
    if (key === "FEATURE_TEAMS") return mockGetFeatureTeams();
    const [resolved] = Object.values(await resolveFromRegistry([key]));
    return resolved;
  },
  getSettings: (keys: string[]) => resolveFromRegistry(keys),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const { GET, POST, PATCH, DELETE } = await import("@/app/api/v3/teams/route");

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockResolvedValue({
    query: (...args: unknown[]) => mockClientQuery(...args),
    release: mockRelease,
  });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true);
  mockGetFeatureTeams.mockReset();
  mockGetFeatureTeams.mockResolvedValue(true);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("elite_supporter");
});

describe("GET /api/v3/teams", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("scopes the team list to the session user via the team_members join", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Acme",
          created_at: "now",
          role: "owner",
          member_count: "1",
        },
      ],
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teams).toHaveLength(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(
      "JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1",
    );
    expect(params).toEqual([42]);
  });
});

describe("POST /api/v3/teams", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(jsonRequest({ name: "Acme" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  /**
   * Settings-wiring regression: FEATURE_TEAMS is a registry-backed
   * deployment-wide kill switch. It used to resolve into a dead
   * FEATURES.TEAMS object nothing ever read, so a self-hoster disabling
   * teams in /admin saw the change save but team creation kept working.
   * This proves the live (mocked) value actually gates the route.
   */
  it("rejects team creation when FEATURE_TEAMS is disabled", async () => {
    mockGetFeatureTeams.mockResolvedValue(false);
    const res = await POST(jsonRequest({ name: "Acme" }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/disabled/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["too short", "a"],
    // MAX_TEAM_NAME_LENGTH's shipped default is 255 (lib/config/registry.ts).
    ["too long", "x".repeat(256)],
    ["non-string", 123],
  ])("rejects a name that is %s", async (_label, name) => {
    const res = await POST(jsonRequest({ name }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects creation once the caller is at their plan's team cap", async () => {
    mockGetUserPlan.mockResolvedValue("pro_supporter"); // teams: 1
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "1" }] });

    const res = await POST(jsonRequest({ name: "Acme" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 1 Teams");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rejects creation entirely on a plan with no team access", async () => {
    mockGetUserPlan.mockResolvedValue("free"); // teams: 0
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });

    const res = await POST(jsonRequest({ name: "Acme" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("not available on your plan");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("counts existing teams scoped to the session user with role=owner", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 9, name: "Acme", slug: "acme-abc", created_at: "now" }],
    }); // INSERT teams
    mockClientQuery.mockResolvedValueOnce({}); // INSERT team_members
    mockClientQuery.mockResolvedValueOnce({}); // COMMIT

    await POST(jsonRequest({ name: "Acme" }));

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("role = $2");
    expect(params).toEqual([42, "owner"]);
  });

  it("creates the team and adds the creator as owner inside a transaction", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 9, name: "Acme", slug: "acme-abc", created_at: "now" }],
    }); // INSERT teams
    mockClientQuery.mockResolvedValueOnce({}); // INSERT team_members
    mockClientQuery.mockResolvedValueOnce({}); // COMMIT

    const res = await POST(jsonRequest({ name: "Acme" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.team).toEqual({
      id: 9,
      name: "Acme",
      slug: "acme-abc",
      created_at: "now",
      role: "owner",
      member_count: 1,
    });

    expect(mockClientQuery.mock.calls[0][0]).toBe("BEGIN");
    const [insertTeamSql, insertTeamParams] = mockClientQuery.mock.calls[1];
    expect(insertTeamSql).toContain("INSERT INTO teams");
    expect(insertTeamParams[0]).toBe("Acme");
    expect(insertTeamParams[2]).toBe(42);
    const [insertMemberSql, insertMemberParams] = mockClientQuery.mock.calls[2];
    expect(insertMemberSql).toContain("INSERT INTO team_members");
    expect(insertMemberParams).toEqual([9, 42, "owner"]);
    expect(mockClientQuery.mock.calls[3][0]).toBe("COMMIT");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("derives the slug from the trimmed, lowercased team name", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockResolvedValueOnce({
      rows: [{ id: 9, name: "My Team!", slug: "my-team-x", created_at: "now" }],
    });
    mockClientQuery.mockResolvedValueOnce({});
    mockClientQuery.mockResolvedValueOnce({});

    await POST(jsonRequest({ name: "  My Team!  " }));

    const [, insertTeamParams] = mockClientQuery.mock.calls[1];
    expect(insertTeamParams[0]).toBe("My Team!");
    expect(insertTeamParams[1]).toMatch(/^my-team-[a-z0-9]+$/);
  });

  it("rolls back and returns 500 when the insert fails", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockClientQuery.mockResolvedValueOnce({}); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("db down")); // INSERT teams fails

    const res = await POST(jsonRequest({ name: "Acme" }));

    expect(res.status).toBe(500);
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/v3/teams", () => {
  function patchRequest(body: unknown): Request {
    return new Request("http://localhost/api/v3/teams", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing teamId or an invalid name", async () => {
    const res = await PATCH(patchRequest({ teamId: 1, name: "x" }));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a requester who is not a team member", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));

    expect(res.status).toBe(403);
  });

  it("rejects a member without owner/admin role", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });

    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("allows an admin to rename the team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, name: "New Name" });
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("UPDATE teams SET name");
    expect(params).toEqual(["New Name", 1]);
  });
});

describe("DELETE /api/v3/teams", () => {
  function deleteRequest(body: unknown): Request {
    return new Request("http://localhost/api/v3/teams", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing teamId", async () => {
    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a requester who is not a team member", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await DELETE(deleteRequest({ teamId: 1 }));

    expect(res.status).toBe(403);
  });

  it("rejects a non-owner member (admin cannot delete)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });

    const res = await DELETE(deleteRequest({ teamId: 1 }));

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("allows the owner to delete, cascading invites and members first", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({}); // DELETE team_invites
    mockQuery.mockResolvedValueOnce({}); // DELETE team_members
    mockQuery.mockResolvedValueOnce({}); // DELETE teams

    const res = await DELETE(deleteRequest({ teamId: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    expect(mockQuery.mock.calls[1][0]).toContain("DELETE FROM team_invites");
    expect(mockQuery.mock.calls[2][0]).toContain("DELETE FROM team_members");
    expect(mockQuery.mock.calls[3][0]).toContain("DELETE FROM teams");
    expect(mockQuery.mock.calls[1][1]).toEqual([1]);
    expect(mockQuery.mock.calls[2][1]).toEqual([1]);
    expect(mockQuery.mock.calls[3][1]).toEqual([1]);
  });
});
