/**
 * Route-level tests for POST /api/v3/admin/staff-invites (create + email a
 * staff invite, AUDIT-010 admin-feature-gap). requireAdmin() (lib/auth/
 * authorization.ts) runs for real -- only getSession and the database are
 * mocked -- so the actual admin-tier gate is exercised, not assumed.
 *
 * Primary focus: this is a privilege-escalation-sensitive endpoint.
 *  - Only admin-tier (admin/super_admin) callers can reach it at all.
 *  - INVITABLE_ROLES caps out at "admin" (never super_admin), so even the
 *    lowest-privileged caller who can reach this route can never grant a
 *    role above their own.
 *  - An existing super_admin's email can never be targeted (regression test
 *    for the fix in app/api/v3/admin/staff-invites/route.ts: without it, a
 *    plain admin could invite the super_admin's own address into a lower
 *    role and silently demote them if the invite were ever accepted).
 *  - The token mailed to the invitee is never the value stored in the DB
 *    (SHA-256 hash only), same as team_invites/password_reset_tokens.
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

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return {
    ...actual,
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

// staffInviteEmail runs for real (importOriginal) so the invite link built
// from the plaintext token is exercised; only the outbound send is mocked.
const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { POST } = await import("@/app/api/v3/admin/staff-invites/route");
const { hashStaffInviteToken } = await import("@/lib/admin/staff-invites");

// requireAdmin: SELECT id, role, totp_enabled FROM users WHERE id = $1
function queueRole(role: string | null, id = 1) {
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id, role, totp_enabled: true }] : [],
  });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/staff-invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockSendEmail.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
});

describe("POST /api/v3/admin/staff-invites — authorization", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a moderator (below the admin tier requireAdmin enforces)", async () => {
    queueRole("moderator");
    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(401);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects a support account", async () => {
    queueRole("support");
    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an attempt to invite someone as super_admin — never invitable through this endpoint", async () => {
    queueRole("super_admin");
    const res = await POST(
      postRequest({ email: "new@example.com", role: "super_admin" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid staff role/i);
    // Only requireAdmin's own lookup ran; role validation happens before
    // any invite-table query.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid/unknown role string", async () => {
    queueRole("admin");
    const res = await POST(
      postRequest({ email: "new@example.com", role: "owner" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v3/admin/staff-invites — super_admin account protection", () => {
  it("refuses to invite an existing super_admin's email into a lower role (would silently demote them on accept)", async () => {
    queueRole("admin"); // caller: a plain admin, not super_admin
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ensureStaffInvitesTable
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 9, role: "super_admin" }],
    }); // existingUser lookup finds the super_admin

    const res = await POST(
      postRequest({ email: "root@example.com", role: "admin" }),
    );

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/cannot be modified/i);
    // Stops immediately: no pending-invite check, no INSERT, no email, no log.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockLogAction).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still allows inviting an existing non-super_admin account (the guard only blocks super_admin targets)", async () => {
    queueRole("super_admin", 1);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ensureStaffInvitesTable
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, role: "moderator" }] }); // existingUser
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite (none pending)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] }); // INSERT ... RETURNING id
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Root", email: "root@example.com" }],
    }); // inviterRes

    const res = await POST(
      postRequest({ email: "mod@example.com", role: "admin" }),
    );

    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      9,
      "staff_invite_sent",
      expect.stringContaining("mod@example.com"),
      "127.0.0.1",
    );
  });
});

describe("POST /api/v3/admin/staff-invites — invite lifecycle", () => {
  it("rejects when the target already holds that exact role", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ensureStaffInvitesTable
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, role: "moderator" }] });

    const res = await POST(
      postRequest({ email: "mod@example.com", role: "moderator" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already holds that role/i);
  });

  it("rejects a duplicate pending invite for the same email", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ensureStaffInvitesTable
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingUser: no account yet
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] }); // existingInvite: pending

    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/already pending/i);
  });

  it("creates the invite, stores only the hashed token, and audit-logs the action", async () => {
    queueRole("admin", 1);
    mockQuery.mockResolvedValueOnce({ rows: [] }); // ensureStaffInvitesTable
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingUser: no account
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite: none pending
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] }); // INSERT ... RETURNING id
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Root Admin", email: "root@example.com" }],
    }); // inviterRes

    const res = await POST(
      postRequest({ email: "New@Example.com ", role: "support" }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.inviteId).toBe(501);

    // Email is normalized (trimmed + lowercased) before storage.
    const insertCall = mockQuery.mock.calls[4];
    expect(insertCall[0]).toContain("INSERT INTO staff_invites");
    const [tokenHash, storedEmail, storedRole] = insertCall[1] as string[];
    expect(storedEmail).toBe("new@example.com");
    expect(storedRole).toBe("support");
    // 64 hex chars = SHA-256 digest, never the raw mailed token.
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);

    // The link mailed to the invitee carries the plaintext token, whose
    // hash must match what was persisted — proving the DB never stores
    // the plaintext value itself.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0][0] as {
      to: string;
      text: string;
    };
    expect(emailArgs.to).toBe("new@example.com");
    const linkMatch = emailArgs.text.match(/staff-invite\/([a-f0-9]{64})/);
    expect(linkMatch).not.toBeNull();
    const plaintextToken = linkMatch![1];
    expect(plaintextToken).not.toBe(tokenHash);
    expect(hashStaffInviteToken(plaintextToken)).toBe(tokenHash);

    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "staff_invite_sent",
      'Invited new@example.com to staff role "support"',
      "127.0.0.1",
    );
  });

  it("does not fail the request if the invite email fails to send", async () => {
    queueRole("admin", 1);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockSendEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(200);
  });
});
