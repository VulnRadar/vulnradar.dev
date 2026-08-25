/**
 * Route-level tests for /api/v3/teams/invitations: GET lists the caller's own
 * pending invitations (by email), DELETE declines one (scoped to the caller's
 * email so an inviteId can't decline someone else's). DB mocked at the pool
 * boundary, same pattern as the accept-invite suite.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let userEmail: string | null = "bob@example.com";
let invitesRows: Record<string, unknown>[] = [];
let deleteRowCount = 1;
const calls: { sql: string; params: unknown[] }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  calls.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT email FROM users")) {
    return { rows: userEmail ? [{ email: userEmail }] : [] };
  }
  if (s.includes("FROM team_invites ti")) {
    return { rows: invitesRows };
  }
  if (s.startsWith("DELETE FROM team_invites")) {
    return { rowCount: deleteRowCount };
  }
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params ?? []),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockMarkHandled = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  markTeamInviteNotificationsHandled: (...args: unknown[]) =>
    mockMarkHandled(...args),
}));

const { GET, DELETE } = await import("@/app/api/v3/teams/invitations/route");

function deleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/teams/invitations", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockMarkHandled.mockReset();
  userEmail = "bob@example.com";
  invitesRows = [];
  deleteRowCount = 1;
  calls.length = 0;
});

describe("GET /api/v3/teams/invitations", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists the caller's own pending invitations, scoped to their email", async () => {
    invitesRows = [
      {
        id: 7,
        role: "viewer",
        created_at: "now",
        expires_at: "later",
        team_name: "Acme",
        invited_by_name: "Alice",
      },
    ];
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.invitations).toHaveLength(1);
    expect(json.invitations[0].team_name).toBe("Acme");

    // The listing query is scoped to the caller's email + only unaccepted,
    // unexpired rows.
    const listCall = calls.find((c) => c.sql.includes("FROM team_invites ti"));
    expect(listCall?.params).toEqual(["bob@example.com"]);
    expect(listCall?.sql).toContain("accepted_at IS NULL");
    expect(listCall?.sql).toContain("expires_at > NOW()");
  });

  it("returns an empty list when the account has no email", async () => {
    userEmail = null;
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.invitations).toEqual([]);
    // Never runs the listing query without an email to scope it to.
    expect(calls.some((c) => c.sql.includes("FROM team_invites ti"))).toBe(
      false,
    );
  });
});

describe("DELETE /api/v3/teams/invitations", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest({ inviteId: 7 }));
    expect(res.status).toBe(401);
  });

  it("requires an inviteId", async () => {
    const res = await DELETE(deleteRequest({}));
    expect(res.status).toBe(400);
  });

  it("declines an invite scoped to the caller's email and clears its notification", async () => {
    const res = await DELETE(deleteRequest({ inviteId: 7 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const delCall = calls.find((c) =>
      c.sql.startsWith("DELETE FROM team_invites"),
    );
    expect(delCall?.params).toEqual([7, "bob@example.com"]);
    expect(mockMarkHandled).toHaveBeenCalledWith(7);
  });

  it("404s when no invite matches the caller's email", async () => {
    deleteRowCount = 0;
    const res = await DELETE(deleteRequest({ inviteId: 999 }));
    expect(res.status).toBe(404);
    expect(mockMarkHandled).not.toHaveBeenCalled();
  });
});
