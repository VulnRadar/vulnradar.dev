/**
 * Route-level tests for POST /api/v3/teams/members (send a team invite),
 * focused on the in-app notification delivery this route now does in
 * addition to the pre-existing email. The database is mocked (network/DB
 * boundary), same pattern as tests/app/api/v3/scan/credentials/route.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// This route only calls getSession() from @/lib/auth, so mock the module
// outright rather than pulling in the real one (importOriginal), which
// transitively loads lib/config/registry.ts and other modules this suite
// doesn't need to exercise.
const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

// Mocked at the resolver boundary (not pool.query) so it doesn't consume
// one of the queueUpToInsert() slots below: the route reads
// TEAM_INVITE_EXPIRY_DAYS through this resolver before the INSERT.
const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

const mockSendEmail = vi.fn();
const mockTeamInviteEmail = vi.fn((..._args: unknown[]) => ({
  subject: "You're invited",
  text: "text",
  html: "<p>html</p>",
}));
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  teamInviteEmail: (...args: unknown[]) => mockTeamInviteEmail(...args),
  teamMemberRemovedEmail: () => ({ subject: "s", text: "t", html: "<p>h</p>" }),
  teamRoleChangedEmail: () => ({ subject: "s", text: "t", html: "<p>h</p>" }),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockCreateUserNotification = vi.fn();
vi.mock("@/lib/notifications/user-notifications", () => ({
  createUserNotification: (...args: unknown[]) =>
    mockCreateUserNotification(...args),
}));

// getUserPlanLimits (lib/billing/plan-limits.ts) is mocked directly: default
// null (unlimited) reproduces every existing test's original no-seat-cap
// assumption without changing them. The route still issues its own real
// "SELECT owner_id FROM teams" query before consulting this, which is why
// queueUpToInsert below queues one extra row for it.
const mockGetUserPlanLimits = vi.fn();
vi.mock("@/lib/billing/plan-limits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/plan-limits")>();
  return {
    ...actual,
    getUserPlanLimits: (...args: unknown[]) => mockGetUserPlanLimits(...args),
  };
});

const { GET, POST, DELETE } = await import("@/app/api/v3/teams/members/route");

beforeEach(async () => {
  // A removal sends its mail on setImmediate, so the previous test's can still
  // be pending here. Let it land before the mocks are reset, or it is counted
  // against whichever test happens to run next.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockReset();
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockGetSession.mockReset();
  mockCheckRateLimit.mockReset();
  mockLogAction.mockReset();
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockTeamInviteEmail.mockClear();
  mockCreateUserNotification.mockReset();
  mockCreateUserNotification.mockResolvedValue(undefined);
  mockGetUserPlanLimits.mockReset();
  mockGetUserPlanLimits.mockResolvedValue(null);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(7);
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 19,
    retryAfterSeconds: 0,
  });
  mockGetSession.mockResolvedValue({ userId: 1 });
});

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/teams/members", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Sets up the query sequence common to every successful invite send up to
// (and including) the invite INSERT.
function queueUpToInsert({
  existingUserId,
  inviteId = 7,
  ownerId = 1,
}: {
  existingUserId: number | null;
  inviteId?: number;
  ownerId?: number;
}) {
  mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] }); // memberRes
  mockQuery.mockResolvedValueOnce({
    rows: existingUserId ? [{ id: existingUserId }] : [],
  }); // existingUser
  if (existingUserId) {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingMember (not already a member)
  }
  mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite
  mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: ownerId }] }); // ownerRes
  mockQuery.mockResolvedValueOnce({ rows: [{ id: inviteId }] }); // INSERT ... RETURNING id
}

describe("POST /api/v3/teams/members", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ teamId: 1, email: "a@b.com" }));
    expect(res.status).toBe(401);
  });

  it("creates an in-app notification when the invited email belongs to an existing user", async () => {
    queueUpToInsert({ existingUserId: 99, inviteId: 7 });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Acme" }] }); // teamInfo
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Alice" }] }); // inviterInfo
    mockQuery.mockResolvedValueOnce({ rows: [{ unsubscribe_token: null }] }); // inviteeRes

    const res = await POST(
      postRequest({ teamId: 1, email: "bob@example.com", role: "viewer" }),
    );

    expect(res.status).toBe(200);
    expect(mockCreateUserNotification).toHaveBeenCalledTimes(1);
    const call = mockCreateUserNotification.mock.calls[0][0];
    expect(call.userId).toBe(99);
    expect(call.type).toBe("team_invite");
    expect(call.relatedType).toBe("team_invite");
    expect(call.relatedId).toBe(7);
    expect(call.title).toContain("Alice");
    expect(call.message).toContain("Acme");
    // The email still goes out too — this is additive, not a replacement.
    expect(mockTeamInviteEmail).toHaveBeenCalled();
  });

  it("does not error and simply skips the in-app notification for an email with no account", async () => {
    queueUpToInsert({ existingUserId: null, inviteId: 8 });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Acme" }] }); // teamInfo
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Alice" }] }); // inviterInfo
    mockQuery.mockResolvedValueOnce({ rows: [] }); // inviteeRes (no account)

    const res = await POST(
      postRequest({
        teamId: 1,
        email: "nobody@example.com",
        role: "viewer",
      }),
    );

    expect(res.status).toBe(200);
    expect(mockCreateUserNotification).not.toHaveBeenCalled();
    // The email invite still works even with no in-app notification.
    expect(mockTeamInviteEmail).toHaveBeenCalled();
  });

  it("audit-logs the invite send with logAction", async () => {
    queueUpToInsert({ existingUserId: 99, inviteId: 7 });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Acme" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Alice" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ unsubscribe_token: null }] });

    await POST(
      postRequest({ teamId: 1, email: "bob@example.com", role: "viewer" }),
    );

    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const [adminId, targetUserId, action] = mockLogAction.mock.calls[0];
    expect(adminId).toBe(1);
    expect(targetUserId).toBe(99);
    expect(action).toBe("team_invite.sent");
  });

  it("a failure creating the notification does not fail the invite response", async () => {
    queueUpToInsert({ existingUserId: 99, inviteId: 7 });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Acme" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ name: "Alice" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ unsubscribe_token: null }] });
    mockCreateUserNotification.mockRejectedValueOnce(new Error("db down"));

    const res = await POST(
      postRequest({ teamId: 1, email: "bob@example.com", role: "viewer" }),
    );

    expect(res.status).toBe(200);
  });

  it("rejects the invite once the team is at the owner's plan seat cap", async () => {
    mockGetUserPlanLimits.mockResolvedValue({
      dailyScans: 0,
      apiKeys: 0,
      apiRequestsPerDay: 0,
      teams: 0,
      teamMembers: 3,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] }); // memberRes
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingUser
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 5 }] }); // ownerRes
    mockQuery.mockResolvedValueOnce({ rows: [{ seats: 3 }] }); // seat count, at cap

    const res = await POST(
      postRequest({ teamId: 1, email: "new@example.com", role: "viewer" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 3 Team members");
    expect(mockGetUserPlanLimits).toHaveBeenCalledWith(5); // the owner, not the inviter
  });

  it("re-applies the seat cap and the duplicate check inside the INSERT", async () => {
    // Both gates are check-then-act. Two admins inviting at the same moment
    // each read a seat count taken before the other wrote, so both passed
    // and the team went a seat over the cap its owner pays for; two invites
    // to the same address raced the same way and produced two live tokens
    // for one person.
    mockGetUserPlanLimits.mockResolvedValue({
      dailyScans: 0,
      apiKeys: 0,
      apiRequestsPerDay: 0,
      teams: 0,
      teamMembers: 5,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] }); // memberRes
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingUser
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 5 }] }); // ownerRes
    mockQuery.mockResolvedValueOnce({ rows: [{ seats: 2 }] }); // seat count
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 11 }] }); // guarded INSERT
    mockQuery.mockResolvedValue({ rows: [] }); // team name / inviter lookups

    await POST(
      postRequest({ teamId: 1, email: "new@example.com", role: "viewer" }),
    );

    const [sql, params] = mockQuery.mock.calls[5];
    expect(sql).toContain("INSERT INTO team_invites");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("FROM team_members WHERE team_id = $1");
    // The owner's cap, bound last.
    expect(params[6]).toBe(5);
  });

  it("reports a lost seat race as a plan limit, not a crash", async () => {
    mockGetUserPlanLimits.mockResolvedValue({
      dailyScans: 0,
      apiKeys: 0,
      apiRequestsPerDay: 0,
      teams: 0,
      teamMembers: 5,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ seats: 4 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the guard refused
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no pending invite, so it was the cap

    const res = await POST(
      postRequest({ teamId: 1, email: "new@example.com", role: "viewer" }),
    );
    const json = await res.json();

    // The old code read rows[0].id straight off an empty result.
    expect(res.status).toBe(400);
    expect(json.error).toContain("up to 5 Team members");
  });

  it("reports a lost duplicate race as a pending invite, not as a plan limit", async () => {
    mockGetUserPlanLimits.mockResolvedValue({
      dailyScans: 0,
      apiKeys: 0,
      apiRequestsPerDay: 0,
      teams: 0,
      teamMembers: 5,
      webhooks: 0,
      scheduledScans: 0,
      bulkScanUrls: 0,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "owner" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ owner_id: 5 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ seats: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the guard refused
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] }); // an invite is pending

    const res = await POST(
      postRequest({ teamId: 1, email: "new@example.com", role: "viewer" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("already pending");
  });

  it("is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
    });

    const res = await POST(
      postRequest({ teamId: 1, email: "bob@example.com" }),
    );

    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/teams/members", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Answers the DELETE route's queries by what they ask, not by position: the
 * leave path and the remove path issue different numbers of them, and
 * dropOrphanedTicketShares adds one more. `roles` maps a user id to that
 * user's role on the team; an id that is absent is not a member.
 */
function routeMemberQueries(roles: Record<number, string>) {
  mockQuery.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.startsWith("SELECT role FROM team_members")) {
      const role = roles[params[1] as number];
      return { rows: role ? [{ role }] : [] };
    }
    if (sql.includes("SELECT name FROM teams")) {
      return { rows: [{ name: "Acme" }] };
    }
    if (sql.includes("SELECT email FROM users")) {
      return { rows: [{ email: "gone@example.com" }] };
    }
    return { rows: [] };
  });
}

/** The membership DELETE the route issued, or undefined when it never did. */
function membershipDelete() {
  return mockQuery.mock.calls.find(([sql]) =>
    String(sql).startsWith("DELETE FROM team_members"),
  );
}

describe("DELETE /api/v3/teams/members", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest({ teamId: 5, userId: "self" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  describe("leaving", () => {
    // The Leave button sends "self". It used to be compared with ===
    // against the numeric session id, so it never matched: a member or
    // viewer fell through to the manage_members check and got a 403, and an
    // admin or manager passed that check and hit a query that cast "self"
    // to an integer, which Postgres rejected with a 500.
    it.each(["viewer", "member", "operator", "manager", "admin"])(
      'lets a %s leave by sending "self"',
      async (role) => {
        routeMemberQueries({ 1: role });

        const res = await DELETE(deleteRequest({ teamId: 5, userId: "self" }));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        // The caller's own id, never the literal.
        expect(membershipDelete()?.[1]).toEqual([5, 1]);
        expect(
          mockQuery.mock.calls.some(([, params]) =>
            (params as unknown[] | undefined)?.includes("self"),
          ),
        ).toBe(false);
      },
    );

    it('treats the caller\'s own numeric id the same as "self"', async () => {
      routeMemberQueries({ 1: "member" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 1 }));

      expect(res.status).toBe(200);
      expect(membershipDelete()?.[1]).toEqual([5, 1]);
    });

    it("accepts the caller's own id as a numeric string", async () => {
      routeMemberQueries({ 1: "viewer" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: "1" }));

      expect(res.status).toBe(200);
      expect(membershipDelete()?.[1]).toEqual([5, 1]);
    });

    it("cleans up the support-ticket shares of the member who left", async () => {
      routeMemberQueries({ 1: "member" });

      await DELETE(deleteRequest({ teamId: 5, userId: "self" }));

      const shares = mockQuery.mock.calls.find(([sql]) =>
        String(sql).includes("DELETE FROM support_ticket_shares"),
      );
      expect(shares?.[1]).toEqual([5, 1]);
    });

    it("refuses an owner, whichever way they name themselves", async () => {
      routeMemberQueries({ 1: "owner" });

      for (const userId of ["self", 1]) {
        const res = await DELETE(deleteRequest({ teamId: 5, userId }));
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.error).toContain("Owners cannot leave");
      }
      expect(membershipDelete()).toBeUndefined();
    });

    it("refuses someone who is not on the team", async () => {
      routeMemberQueries({});

      const res = await DELETE(deleteRequest({ teamId: 5, userId: "self" }));

      expect(res.status).toBe(403);
      expect(membershipDelete()).toBeUndefined();
    });
  });

  describe("a userId that is not an id", () => {
    // Each of these used to reach Postgres as a bind parameter, where an
    // integer column rejects it with 22P02 and the caller sees a bare 500.
    it.each([
      ["a word", "abc"],
      ["a fraction", 1.5],
      ["a boolean", true],
      ["an array", [1]],
      ["an object", { id: 1 }],
      ["scientific notation", "1e3"],
      ["a negative number", -4],
      ["a negative string", "-4"],
      ["trailing text", "7; DROP TABLE users"],
      ["more than an INTEGER holds", 99999999999],
    ])("answers 400 for %s", async (_label, userId) => {
      routeMemberQueries({ 1: "admin" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(typeof json.error).toBe("string");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("still asks for both ids when one is missing", async () => {
      const res = await DELETE(deleteRequest({ teamId: 5 }));
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("removing someone else", () => {
    it("lets an admin remove a member", async () => {
      routeMemberQueries({ 1: "admin", 2: "member" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 2 }));

      expect(res.status).toBe(200);
      expect(membershipDelete()?.[1]).toEqual([5, 2]);
    });

    it("tells the member they were removed", async () => {
      routeMemberQueries({ 1: "admin", 2: "member" });

      await DELETE(deleteRequest({ teamId: 5, userId: 2 }));
      // The mail goes out on setImmediate, after the response.
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockSendNotificationEmail).toHaveBeenCalledTimes(1);
      expect(mockSendNotificationEmail.mock.calls[0][0]).toMatchObject({
        userId: 2,
        userEmail: "gone@example.com",
        type: "team_changes",
      });
    });

    it("does not act, or send a removal mail, for someone who is not on the team", async () => {
      // Without this stop an admin could name any account's id and have the
      // platform mail it "you were removed from <their team's name>".
      routeMemberQueries({ 1: "admin" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 77 }));
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.status).toBe(200);
      expect(membershipDelete()).toBeUndefined();
      expect(mockSendNotificationEmail).not.toHaveBeenCalled();
      expect(
        mockQuery.mock.calls.some(([sql]) =>
          String(sql).includes("SELECT email FROM users"),
        ),
      ).toBe(false);
    });

    it("accepts the target as a numeric string", async () => {
      routeMemberQueries({ 1: "admin", 2: "member" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: "2" }));

      expect(res.status).toBe(200);
      expect(membershipDelete()?.[1]).toEqual([5, 2]);
    });

    it("refuses a caller without manage_members", async () => {
      routeMemberQueries({ 1: "member", 2: "viewer" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 2 }));

      expect(res.status).toBe(403);
      expect(membershipDelete()).toBeUndefined();
    });

    it("never removes the owner", async () => {
      routeMemberQueries({ 1: "admin", 2: "owner" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 2 }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("owner");
      expect(membershipDelete()).toBeUndefined();
    });

    it("keeps the role ceiling: a manager cannot remove an admin", async () => {
      routeMemberQueries({ 1: "manager", 2: "admin" });

      const res = await DELETE(deleteRequest({ teamId: 5, userId: 2 }));

      expect(res.status).toBe(403);
      expect(membershipDelete()).toBeUndefined();
    });
  });

  describe("cancelling an invite", () => {
    it("lets a caller with manage_members cancel", async () => {
      routeMemberQueries({ 1: "manager" });

      const res = await DELETE(deleteRequest({ teamId: 5, inviteId: 9 }));

      expect(res.status).toBe(200);
      expect(
        mockQuery.mock.calls.find(([sql]) =>
          String(sql).startsWith("DELETE FROM team_invites"),
        )?.[1],
      ).toEqual([9, 5]);
    });

    it("refuses a viewer", async () => {
      routeMemberQueries({ 1: "viewer" });

      const res = await DELETE(deleteRequest({ teamId: 5, inviteId: 9 }));

      expect(res.status).toBe(403);
    });
  });

  it("answers a database failure with a JSON 500 instead of throwing", async () => {
    // DELETE had no try/catch, so the 22P02 above surfaced as a thrown error
    // out of the route handler.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    const res = await DELETE(deleteRequest({ teamId: 5, userId: "self" }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(typeof json.error).toBe("string");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("the other members handlers", () => {
  it("answer a database failure with a JSON 500 as well", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error("connection terminated"));

    const res = await GET(
      new NextRequest("http://localhost/api/v3/teams/members?teamId=5"),
    );

    expect(res.status).toBe(500);
    expect(typeof (await res.json()).error).toBe("string");
    spy.mockRestore();
  });
});
