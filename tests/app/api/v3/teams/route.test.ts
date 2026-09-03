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

  /** One listed team, plus the follow-up query that decorates it with team
   *  picture URLs. `stamps` is what team_avatars returns for it. */
  function mockTeamList(stamps: { team_id: number; updated_at: Date }[] = []) {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Acme",
          slug: "acme",
          owner_id: 42,
          owner_name: "Ada",
          owner_email: "ada@example.com",
          owner_avatar_url: null,
          created_at: "now",
          role: "owner",
          member_count: "1",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: stamps });
  }

  it("scopes the team list to the session user via the team_members join", async () => {
    mockTeamList();

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

  /**
   * components/teams/teams-list.tsx renders owner_name/owner_email on every
   * row and this query selected neither, so a row read "owned by undefined"
   * over a "?" placeholder for anyone looking at a team they do not own.
   */
  it("selects the owner's identity, which the list renders on every row", async () => {
    mockTeamList();

    const res = await GET();
    const json = await res.json();

    expect(json.teams[0].owner_name).toBe("Ada");
    expect(json.teams[0].owner_email).toBe("ada@example.com");
    expect(mockQuery.mock.calls[0][0]).toContain("LEFT JOIN users u");
  });

  it("derives each team's picture URL from its stored row, not a column", async () => {
    const updatedAt = new Date("2026-01-02T03:04:05Z");
    mockTeamList([{ team_id: 1, updated_at: updatedAt }]);

    const res = await GET();
    const json = await res.json();

    expect(json.teams[0].avatar_url).toBe(
      `/api/v3/teams/avatar/1?v=${updatedAt.getTime()}`,
    );
  });

  it("gives a team with no stored picture a null url, so the UI falls back instead of loading a broken image", async () => {
    mockTeamList();

    const res = await GET();
    const json = await res.json();

    expect(json.teams[0].avatar_url).toBeNull();
  });

  /** team_avatars is created at boot with onError: "warn", so a deployment
   *  where that create failed must still be able to list teams. */
  it("still lists teams when the picture lookup fails outright", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, name: "Acme", role: "owner", member_count: "1" }],
    });
    mockQuery.mockRejectedValueOnce(
      new Error('relation "team_avatars" does not exist'),
    );

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.teams).toHaveLength(1);
    expect(json.teams[0].avatar_url).toBeNull();
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

  /**
   * The team picture rides on this same PATCH, the way a user's does on
   * PATCH /api/v3/auth/update. Teams gained an avatar in the UI with no way to
   * set one; these pin the three things that make setting one safe: only a
   * member who can manage the team may do it, the bytes go through the same
   * validator as a profile picture (so an SVG carrying a <script> is refused),
   * and clearing it removes the stored row rather than leaving an orphan.
   */
  describe("team picture", () => {
    // A minimal but genuinely PNG-signed payload: validateAvatarDataUrl checks
    // magic bytes, so base64 of arbitrary text would be rejected for the wrong
    // reason and the test would pass without proving anything.
    const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]).toString("base64")}`;

    it("rejects a body carrying neither a name nor a picture", async () => {
      const res = await PATCH(patchRequest({ teamId: 1 }));
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("refuses a member who cannot manage the team, before storing anything", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }] });

      const res = await PATCH(
        patchRequest({ teamId: 1, avatarUrl: PNG_DATA_URL }),
      );

      expect(res.status).toBe(403);
      // Permission check only: no INSERT reached team_avatars.
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("refuses an SVG data URL even from an owner", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });

      const res = await PATCH(
        patchRequest({
          teamId: 1,
          avatarUrl: `data:image/svg+xml;base64,${Buffer.from(
            "<svg onload=alert(1)></svg>",
          ).toString("base64")}`,
        }),
      );

      expect(res.status).toBe(400);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it("stores validated bytes and returns the URL that serves them back", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ updated_at: new Date("2026-01-02T03:04:05Z") }],
      });

      const res = await PATCH(
        patchRequest({ teamId: 1, avatarUrl: PNG_DATA_URL }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      const [sql, params] = mockQuery.mock.calls[1];
      expect(sql).toContain("INSERT INTO team_avatars");
      expect(params[0]).toBe(1);
      expect(params[1]).toBeInstanceOf(Buffer);
      expect(params[2]).toBe("image/png");
      // The stamp comes from the stored row, so the URL the client renders and
      // the one the teams list builds on its next load are the same URL.
      expect(json.avatarUrl).toBe(
        `/api/v3/teams/avatar/1?v=${new Date("2026-01-02T03:04:05Z").getTime()}`,
      );
    });

    it("clears the picture on an empty string and reports it as removed", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "manager" }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await PATCH(patchRequest({ teamId: 1, avatarUrl: "" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.avatarUrl).toBeNull();
      expect(mockQuery.mock.calls[1][0]).toContain("DELETE FROM team_avatars");
      expect(mockQuery.mock.calls[1][1]).toEqual([1]);
    });

    it("leaves the name alone when only the picture is sent", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await PATCH(patchRequest({ teamId: 1, avatarUrl: "" }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).not.toHaveProperty("name");
      for (const [sql] of mockQuery.mock.calls) {
        expect(sql).not.toContain("UPDATE teams SET name");
      }
    });
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

  it("allows the owner to delete, cascading invites and members via one atomic DELETE", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] }); // membership
    mockQuery.mockResolvedValueOnce({ rows: [] }); // roster, read for the notices
    mockQuery.mockResolvedValueOnce({}); // DELETE teams (cascades invites + members)

    const res = await DELETE(deleteRequest({ teamId: 1 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true });
    // A single DELETE FROM teams; team_members/team_invites cascade via their
    // ON DELETE CASCADE FK, so no separate (non-atomic) deletes are issued.
    //
    // Asserted by statement shape rather than by call count. The route now
    // also reads the member roster before the cascade, so it can tell the
    // people who are about to lose access that the team is gone, and a bare
    // count cannot tell that read apart from the hand-rolled child deletes
    // this test exists to forbid. The shape check is the stricter of the two:
    // it names the statements that must not appear.
    const statements = mockQuery.mock.calls.map((c) => String(c[0]));
    expect(
      statements.filter((s) => s.includes("DELETE FROM teams")),
    ).toHaveLength(1);
    expect(statements.some((s) => s.includes("DELETE FROM team_members"))).toBe(
      false,
    );
    expect(statements.some((s) => s.includes("DELETE FROM team_invites"))).toBe(
      false,
    );
    const deleteCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("DELETE FROM teams"),
    );
    expect(deleteCall?.[1]).toEqual([1]);
  });
});
