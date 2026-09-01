/**
 * Multi-team scan sharing: lib/teams/scan-teams.ts.
 *
 * A scan used to belong to at most one team (scan_history.team_id), so the
 * share picker was a radiogroup and picking a second team silently un-shared
 * the first. The set now lives in scan_history_teams. This suite covers the
 * two halves that decide who sees what: the access rule widened from one team
 * to a set, and the authorization gate on changing that set.
 *
 * pool.query is faked, as everywhere in this tier, so nothing here proves
 * anything about the SQL itself (see tests/README.md's "Two tiers, two
 * rules"). What it proves is the decision logic on top of it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetAssignableTeamIds = vi.fn();
vi.mock("@/lib/auth/team-resource-access", () => ({
  getAssignableTeamIds: (...args: unknown[]) =>
    mockGetAssignableTeamIds(...args),
}));

const {
  getScanTeamIds,
  getScanTeamAccess,
  getScanResourceAccess,
  parseTeamIdsInput,
  resolveNewScanTeamIds,
  authorizeScanTeamChange,
  setScanTeams,
  attachNewScanTeams,
  scanTeamMatchSql,
} = await import("@/lib/teams/scan-teams");

beforeEach(() => {
  mockQuery.mockReset();
  mockGetAssignableTeamIds.mockReset();
  mockGetAssignableTeamIds.mockResolvedValue([]);
});

describe("getScanTeamIds", () => {
  it("unions the join table with the legacy team_id column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 4 }, { team_id: 9 }] });

    const ids = await getScanTeamIds(55);

    expect(ids).toEqual([4, 9]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("FROM scan_history_teams WHERE scan_id = $1");
    // The legacy column has to stay in the read: scheduled runs and crawl
    // child pages are still written by paths that only know it, and a scan
    // that silently stops appearing for its team is the whole failure mode
    // this union exists to prevent.
    expect(sql).toContain("SELECT team_id FROM scan_history WHERE id = $1");
    expect(params).toEqual([55]);
  });
});

describe("getScanTeamAccess", () => {
  it("gives the scan's own creator full access without a lookup", async () => {
    const access = await getScanTeamAccess(7, 7, [4]);

    expect(access).toEqual({ canRead: true, canWrite: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("denies a non-owner on a scan shared with no team at all", async () => {
    const access = await getScanTeamAccess(7, 99, []);

    expect(access).toEqual({ canRead: false, canWrite: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("takes the strongest role the caller holds across the scan's teams", async () => {
    // Viewer in one of the scan's teams, member in another: sharing into a
    // second team can only widen access, so this reads as member.
    mockQuery.mockResolvedValueOnce({
      rows: [{ role: "viewer" }, { role: "member" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // owner, not god-mode

    const access = await getScanTeamAccess(7, 99, [4, 9]);

    expect(access).toEqual({ canRead: true, canWrite: true });
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual([7, [4, 9]]);
  });

  it("gives a viewer-only caller read but not write", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });

    expect(await getScanTeamAccess(7, 99, [4])).toEqual({
      canRead: true,
      canWrite: false,
    });
  });

  it("denies a caller who is in none of the scan's teams", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    expect(await getScanTeamAccess(7, 99, [4, 9])).toEqual({
      canRead: false,
      canWrite: false,
    });
  });

  it("never grants write on a super_admin's scan, whatever the team role", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "super_admin" }] });

    expect(await getScanTeamAccess(7, 99, [4])).toEqual({
      canRead: true,
      canWrite: false,
    });
  });
});

describe("getScanResourceAccess", () => {
  it("short-circuits for the owner without resolving the team set", async () => {
    const access = await getScanResourceAccess(7, {
      id: 55,
      user_id: 7,
      team_id: 4,
    });

    expect(access).toEqual({ canRead: true, canWrite: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("resolves the scan's team set for a non-owner before deciding", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 4 }] }); // getScanTeamIds
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "member" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });

    const access = await getScanResourceAccess(7, {
      id: 55,
      user_id: 99,
      team_id: 4,
    });

    expect(access).toEqual({ canRead: true, canWrite: true });
  });
});

describe("parseTeamIdsInput", () => {
  it("reports nothing provided when neither field is present", () => {
    expect(parseTeamIdsInput({})).toEqual({
      ok: true,
      provided: false,
      teamIds: [],
    });
  });

  it("reads a teamIds array", () => {
    expect(parseTeamIdsInput({ teamIds: [4, 9] })).toEqual({
      ok: true,
      provided: true,
      teamIds: [4, 9],
    });
  });

  it("treats the legacy single teamId as a one-element set", () => {
    expect(parseTeamIdsInput({ teamId: 4 })).toEqual({
      ok: true,
      provided: true,
      teamIds: [4],
    });
  });

  it("treats teamId null as an explicit empty set", () => {
    expect(parseTeamIdsInput({ teamId: null })).toEqual({
      ok: true,
      provided: true,
      teamIds: [],
    });
  });

  it("deduplicates repeated ids rather than failing", () => {
    expect(parseTeamIdsInput({ teamIds: [4, 4, 9] })).toMatchObject({
      ok: true,
      teamIds: [4, 9],
    });
  });

  it("refuses both fields at once instead of guessing which one was meant", () => {
    const parsed = parseTeamIdsInput({ teamId: 4, teamIds: [9] });
    expect(parsed.ok).toBe(false);
  });

  it.each([[["4"]], [[0]], [[-1]], [[1.5]], [[null]]])(
    "rejects %j as a team id list",
    (teamIds) => {
      expect(parseTeamIdsInput({ teamIds }).ok).toBe(false);
    },
  );

  it("rejects a teamIds that is not an array", () => {
    expect(parseTeamIdsInput({ teamIds: 4 }).ok).toBe(false);
  });
});

describe("resolveNewScanTeamIds", () => {
  it("defaults a new scan to personal, with no team lookup", async () => {
    const resolved = await resolveNewScanTeamIds(7, {});

    expect(resolved).toEqual({ ok: true, teamIds: [], primaryTeamId: null });
    expect(mockGetAssignableTeamIds).not.toHaveBeenCalled();
  });

  it("accepts teams the caller can manage and names the first as primary", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4, 9, 12]);

    expect(await resolveNewScanTeamIds(7, { teamIds: [9, 4] })).toEqual({
      ok: true,
      teamIds: [9, 4],
      primaryTeamId: 9,
    });
  });

  it("refuses the whole request when any named team is not assignable", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4]);

    const resolved = await resolveNewScanTeamIds(7, { teamIds: [4, 9] });

    expect(resolved.ok).toBe(false);
  });
});

describe("authorizeScanTeamChange", () => {
  it("allows a no-op without consulting the caller's teams", async () => {
    expect(await authorizeScanTeamChange(7, [4, 9], [4, 9])).toEqual({
      ok: true,
    });
    expect(mockGetAssignableTeamIds).not.toHaveBeenCalled();
  });

  it("allows adding a team the caller can manage", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4, 9]);

    expect(await authorizeScanTeamChange(7, [4], [4, 9])).toEqual({ ok: true });
  });

  it("refuses adding a team the caller cannot manage", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4]);

    const result = await authorizeScanTeamChange(7, [4], [4, 9]);

    expect(result.ok).toBe(false);
  });

  it("refuses REMOVING a team the caller cannot manage", async () => {
    // The trap a replacement-array contract sets: every id still in the
    // request is one the caller manages, so an additions-only check would
    // wave this through and quietly drop team 9.
    mockGetAssignableTeamIds.mockResolvedValue([4]);

    const result = await authorizeScanTeamChange(7, [4, 9], [4]);

    expect(result.ok).toBe(false);
  });

  it("allows removing a team the caller can manage", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4, 9]);

    expect(await authorizeScanTeamChange(7, [4, 9], [4])).toEqual({ ok: true });
  });

  it("allows clearing every team when the caller manages them all", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4, 9]);

    expect(await authorizeScanTeamChange(7, [4, 9], [])).toEqual({ ok: true });
  });

  it("refuses clearing when one of the teams being cleared is unmanageable", async () => {
    mockGetAssignableTeamIds.mockResolvedValue([4]);

    expect((await authorizeScanTeamChange(7, [4, 9], [])).ok).toBe(false);
  });
});

describe("setScanTeams", () => {
  it("rewrites the join table and re-points the primary column in one statement", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await setScanTeams(55, [9, 4]);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("DELETE FROM scan_history_teams");
    expect(sql).toContain("team_id <> ALL($2::int[])");
    expect(sql).toContain("INSERT INTO scan_history_teams (scan_id, team_id)");
    // Must name the join table's composite primary key: an ON CONFLICT
    // target with no matching unique index throws at execution time, on the
    // write path. tests/lib/database/on-conflict-parity.test.ts checks this
    // against the real schema.
    expect(sql).toContain("ON CONFLICT (scan_id, team_id) DO NOTHING");
    expect(sql).toContain("UPDATE scan_history SET team_id = $3");
    expect(params).toEqual([55, [9, 4], 9]);
  });

  it("clears the primary column when the set is emptied", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await setScanTeams(55, []);

    expect(mockQuery.mock.calls[0][1]).toEqual([55, [], null]);
  });
});

describe("attachNewScanTeams", () => {
  it("does nothing below two teams: the INSERT already wrote the primary", async () => {
    await attachNewScanTeams(55, []);
    await attachNewScanTeams(55, [4]);

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("writes the set once there is more than one team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await attachNewScanTeams(55, [4, 9]);

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("swallows a failure rather than failing the scan that already exists", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("nope"));

    await expect(attachNewScanTeams(55, [4, 9])).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe("scanTeamMatchSql", () => {
  it("matches the join table and the legacy column, both bound to the same param", () => {
    const sql = scanTeamMatchSql("sh", "$2");

    expect(sql).toContain("sh.team_id = $2");
    expect(sql).toContain("FROM scan_history_teams sht");
    expect(sql).toContain("sht.scan_id = sh.id AND sht.team_id = $2");
  });
});
