import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for lib/auth/team-resource-access.ts, the shared gate every
 * org-scoped resource route (scans, API keys, webhooks, schedules) uses
 * to decide read/write access. Mocked at the database boundary only --
 * TEAM_ROLE_PERMISSIONS and STAFF_PERMISSIONS.GOD_MODE lookups run for
 * real, since a bug in either would make this suite pass while the real
 * permission logic is wrong.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { getTeamResourceAccess, getAssignableTeamIds } =
  await import("@/lib/auth/team-resource-access");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getTeamResourceAccess", () => {
  it("grants full access to the resource's own creator, no query needed", async () => {
    const result = await getTeamResourceAccess(5, 5, null);
    expect(result).toEqual({ canRead: true, canWrite: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("denies access to a personal (team_id null) resource for anyone but the owner", async () => {
    const result = await getTeamResourceAccess(7, 5, null);
    expect(result).toEqual({ canRead: false, canWrite: false });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("denies access when the caller is not a member of the resource's team", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // team_members lookup: no row
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result).toEqual({ canRead: false, canWrite: false });
  });

  it("grants read-only access to a viewer-role co-member", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // owner role
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result).toEqual({ canRead: true, canWrite: false });
  });

  it.each(["owner", "admin", "operator", "member"])(
    "grants read+write access to a %s-role co-member (holds manage_scans)",
    async (role) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ role }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });
      const result = await getTeamResourceAccess(7, 5, 1);
      expect(result).toEqual({ canRead: true, canWrite: true });
    },
  );

  it("grants read-only access to a manager-role co-member (manages people/settings, not scans)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "manager" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result).toEqual({ canRead: true, canWrite: false });
  });

  it("blocks write access for anyone but the owner when the owner is super_admin, even an owner-role co-member", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "super_admin" }] });
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result).toEqual({ canRead: true, canWrite: false });
  });

  it("still allows the super_admin owner themselves full access to their own resource", async () => {
    const result = await getTeamResourceAccess(5, 5, 1);
    expect(result).toEqual({ canRead: true, canWrite: true });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not grant write to a super_admin-owned resource's team even for an admin-role member", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "super_admin" }] });
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result.canWrite).toBe(false);
  });

  it("treats an unrecognized team role as no access", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "not-a-real-role" }] });
    const result = await getTeamResourceAccess(7, 5, 1);
    expect(result).toEqual({ canRead: false, canWrite: false });
  });
});

describe("getAssignableTeamIds", () => {
  it("returns only teams where the caller's role grants manage_scans", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { team_id: 1, role: "owner" },
        { team_id: 2, role: "admin" },
        { team_id: 3, role: "member" },
        { team_id: 4, role: "viewer" },
        { team_id: 5, role: "operator" },
        { team_id: 6, role: "manager" },
      ],
    });
    const result = await getAssignableTeamIds(7);
    // 4 (viewer) and 6 (manager) excluded -- neither holds manage_scans.
    expect(result.sort()).toEqual([1, 2, 3, 5]);
  });

  it("returns an empty array for a caller with no team memberships", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await getAssignableTeamIds(7);
    expect(result).toEqual([]);
  });
});
