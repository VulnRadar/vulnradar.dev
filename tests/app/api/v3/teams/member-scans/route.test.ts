/**
 * Route-level tests for GET /api/v3/teams/member-scans: a team member
 * viewing another team member's scan history.
 *
 * This is the ownership/authorization core of the file: it requires BOTH
 * the requester and the target user to be members of the SAME teamId (two
 * separate `SELECT role FROM team_members WHERE team_id = $1 AND user_id =
 * $2` queries, one for session.userId, one for the userId query param),
 * before scoping the scan_history read to the target's rows only.
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

// FEATURE_TEAMS is the deployment-wide kill switch every /api/v3/teams
// handler now checks (lib/teams/feature-gate.ts). Mocked at the settings
// resolver so it doesn't consume an entry from this suite's ordered
// pool.query queue.
const mockFeatureTeams = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) =>
    key === "FEATURE_TEAMS" ? mockFeatureTeams() : undefined,
}));

const { GET } = await import("@/app/api/v3/teams/member-scans/route");

function getRequest(params: Record<string, string>): NextRequest {
  const search = new URLSearchParams(params).toString();
  return new NextRequest(
    `http://localhost/api/v3/teams/member-scans?${search}`,
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockFeatureTeams.mockReset();
  mockFeatureTeams.mockResolvedValue(true);
});

describe("GET /api/v3/teams/member-scans", () => {
  it("returns 403 and touches no data when FEATURE_TEAMS is off", async () => {
    mockFeatureTeams.mockResolvedValue(false);

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("requires both teamId and userId query params", async () => {
    const res1 = await GET(getRequest({ teamId: "3" }));
    expect(res1.status).toBe(400);

    const res2 = await GET(getRequest({ userId: "99" }));
    expect(res2.status).toBe(400);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the requester is not on the specified team at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // requesterCheck: no membership row

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe("Not a team member.");
    // Only the requester check ran; the target check and scan history query
    // must never fire once authorization already failed.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE team_id = $1 AND user_id = $2");
    expect(params).toEqual(["3", 42]);
  });

  it("rejects with 403 when the requester is a member of a different team than the one specified", async () => {
    // Same code path as "not a team member at all": the requester belongs
    // to some other team (say team 7), but the query is scoped to
    // team_id = $1 (the requested teamId, "3"), so the lookup for
    // (team_id=3, user_id=42) still comes back empty.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));

    expect(res.status).toBe(403);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe("3");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects with 404 when the target user is not a member of the team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }] }); // requesterCheck ok
    mockQuery.mockResolvedValueOnce({ rows: [] }); // targetCheck: not a member

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("User is not a team member.");
    // Both membership checks ran, but the scan history query must not.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE team_id = $1 AND user_id = $2");
    expect(params).toEqual(["3", "99"]);
  });

  it("returns 200 with scans scoped to the target user only when both are team members", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }] }); // requesterCheck
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] }); // targetCheck
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com",
          findings_count: 2,
          duration: 500,
          scanned_at: "now",
        },
      ],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 7 }] });

    const res = await GET(getRequest({ teamId: "3", userId: "99" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.scans).toHaveLength(1);
    // Three reads plus the count that backs the reported total.
    expect(mockQuery).toHaveBeenCalledTimes(4);

    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("FROM scan_history");
    // Scoped to the target userId AND the team, so a member's private personal
    // scans never surface in the team view. A scan can be shared with several
    // teams at once, so the team half of the filter is the scan_history_teams
    // join; it still matches the legacy team_id column, so a scan written by a
    // path that only knows that column does not vanish from the team's view.
    expect(sql).toContain("sh.user_id = $1");
    expect(sql).toContain("FROM scan_history_teams sht");
    expect(sql).toContain("sht.team_id = $2");
    expect(sql).toContain("sh.team_id = $2");
    expect(params).toEqual(["99", "3", 50]);

    // The 50-row cap used to be invisible: the panel drove its paginator from
    // the returned array's length, so it reported the truncated count as the
    // total (AUDIT-014#magic-20).
    expect(json.limit).toBe(50);
    expect(json.total).toBe(7);
  });

  it("does not leak the requester's own scans when they request another member's history", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await GET(getRequest({ teamId: "3", userId: "99" }));

    const [, params] = mockQuery.mock.calls[2];
    expect(params).not.toEqual([42]);
    expect(params).toEqual(["99", "3", 50]);
    // The count that backs the reported total is scoped identically.
    expect(mockQuery.mock.calls[3][1]).toEqual(["99", "3"]);
  });
});
