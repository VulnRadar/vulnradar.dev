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
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

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

const { POST } = await import("@/app/api/v3/teams/members/route");

beforeEach(() => {
  mockQuery.mockReset();
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
