/**
 * Route-level tests for GET/PATCH/DELETE /api/v3/admin/teams (admin
 * override of team name / deletion). Auth is a local checkAdminAccess
 * (admin or moderator only); DELETE additionally requires the caller's role
 * to be exactly "admin". Only getSession and the database are mocked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn(async () => ({
  query: mockClientQuery,
  release: mockClientRelease,
}));
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAuditAction: (...args: unknown[]) => mockLogAction(...args),
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

// The route resolves MAX_TEAM_NAME_LENGTH via getSetting. Resolve it from the
// real registry default (255) rather than a hand-copied number, and without
// touching the mocked pool -- otherwise this settings lookup would silently
// consume one of the queued mockQuery.mockResolvedValueOnce() values meant
// for the route's own team-lookup queries below.
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) => {
    const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
    return SETTINGS_REGISTRY[key as keyof typeof SETTINGS_REGISTRY].default;
  },
}));

const routeModule = await import("@/app/api/v3/admin/teams/route");
const { GET, PATCH, DELETE } = routeModule;

function withRole(role: string) {
  mockGetSession.mockResolvedValue({ userId: 1 });
  // checkAdminAccess does its own SELECT role FROM users WHERE id=$1 lookup.
  mockQuery.mockResolvedValueOnce({ rows: [{ role }] });
}

function getRequest(url = "http://localhost/api/v3/admin/teams"): Request {
  return new Request(url);
}

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/admin/teams", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/admin/teams", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockImplementation(async () => ({
    query: mockClientQuery,
    release: mockClientRelease,
  }));
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockGetSession.mockReset();
  mockLogAction.mockReset();
});

describe("GET /api/v3/admin/teams", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("rejects a support-tier caller — teams admin is moderator+ only", async () => {
    withRole("support");
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  it("allows a moderator to list teams", async () => {
    withRole("moderator");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // count
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme" }] }); // teams
    const res = await GET(getRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.teams).toHaveLength(1);
  });

  it("allows a super_admin to list teams (passes every admin-or-higher check)", async () => {
    withRole("super_admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, name: "Acme" }] });
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/v3/admin/teams", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));
    expect(res.status).toBe(401);
  });

  it("rejects a support-tier caller", async () => {
    withRole("support");
    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));
    expect(res.status).toBe(403);
  });

  it("requires teamId", async () => {
    withRole("moderator");
    const res = await PATCH(patchRequest({ name: "New Name" }));
    expect(res.status).toBe(400);
  });

  it("rejects a name shorter than 2 characters", async () => {
    withRole("moderator");
    const res = await PATCH(patchRequest({ teamId: 1, name: "x" }));
    expect(res.status).toBe(400);
  });

  it("rejects a name longer than MAX_TEAM_NAME_LENGTH (255 by default)", async () => {
    withRole("moderator");
    const res = await PATCH(patchRequest({ teamId: 1, name: "x".repeat(256) }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown team", async () => {
    withRole("moderator");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await PATCH(patchRequest({ teamId: 999, name: "New Name" }));
    expect(res.status).toBe(404);
  });

  it("lets a moderator rename a team and audit-logs it (via the dynamic logAuditAction import)", async () => {
    withRole("moderator");
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Old Name" }] }); // current name
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await PATCH(patchRequest({ teamId: 1, name: "New Name" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.name).toBe("New Name");
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "edit_team",
      expect.stringContaining("New Name"),
      "127.0.0.1",
    );
  });
});

describe("DELETE /api/v3/admin/teams", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    expect(res.status).toBe(401);
  });

  it("rejects a moderator — team deletion is stricter than view/edit and requires the exact admin role", async () => {
    withRole("moderator");
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/Only admins can delete teams/);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown team", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await DELETE(deleteRequest({ teamId: 999 }));
    expect(res.status).toBe(404);
  });

  it("deletes the team in a transaction and audit-logs it", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Acme",
          owner_id: 9,
          owner_email: "owner@example.com",
          member_count: 3,
        },
      ],
    });
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    expect(res.status).toBe(200);
    expect(mockClientQuery.mock.calls[0][0]).toBe("BEGIN");
    const last =
      mockClientQuery.mock.calls[mockClientQuery.mock.calls.length - 1];
    expect(last[0]).toBe("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      9,
      "delete_team",
      expect.stringContaining("Acme"),
      "127.0.0.1",
    );
  });

  it("allows a super_admin to delete a team, not just the literal 'admin' role", async () => {
    withRole("super_admin");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Acme",
          owner_id: 9,
          owner_email: "owner@example.com",
          member_count: 3,
        },
      ],
    });
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    expect(res.status).toBe(200);
  });

  it("rolls back and returns a graceful 500 when the transaction fails", async () => {
    withRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          name: "Acme",
          owner_id: 9,
          owner_email: "owner@example.com",
          member_count: 3,
        },
      ],
    });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("delete failed"));
    const res = await DELETE(deleteRequest({ teamId: 1 }));
    expect(res.status).toBe(500);
    const rollbackCall = mockClientQuery.mock.calls.find(
      (c) => c[0] === "ROLLBACK",
    );
    expect(rollbackCall).toBeTruthy();
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});
