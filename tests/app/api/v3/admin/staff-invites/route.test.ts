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

// Sending an invite is password-gated (send_staff_invite in
// PASSWORD_GATED_ACTIONS): it grants the same privilege PATCH
// /api/v3/admin's set_role does, so it requires the same re-auth. Only the
// hash comparison is mocked; the route's own gate runs for real.
const mockVerifyPassword = vi.fn(
  async (plain: string, _hash: string) => plain === "correct-admin-pw",
);
vi.mock("@/lib/auth/password-hash", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/password-hash")>();
  return {
    ...actual,
    verifyPassword: (plain: string, hash: string) =>
      mockVerifyPassword(plain, hash),
  };
});

// staffInviteEmail runs for real (importOriginal) so the invite link built
// from the plaintext token is exercised; only the outbound send is mocked.
const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { POST, GET, DELETE } =
  await import("@/app/api/v3/admin/staff-invites/route");
const { hashStaffInviteToken } = await import("@/lib/admin/staff-invites");

// requireAdmin: SELECT id, role, totp_enabled FROM users WHERE id = $1
function queueRole(role: string | null, id = 1) {
  mockQuery.mockResolvedValueOnce({
    rows: role ? [{ id, role, totp_enabled: true }] : [],
  });
}

// Supplies the re-auth password unless a test overrides it, so the existing
// cases keep testing what they were written to test.
function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/staff-invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ currentAdminPassword: "correct-admin-pw", ...body }),
  });
}

/** The route's password-hash lookup, queued right after requireAdmin's. */
function queueAdminPassword() {
  mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: "hashed" }] });
}

function deleteRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/staff-invites", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockSendEmail.mockReset();
  mockVerifyPassword.mockClear();
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

  // send_staff_invite is in PASSWORD_GATED_ACTIONS. Granting the same role
  // through PATCH /api/v3/admin has always required re-auth; this route used
  // to grant it on requireAdmin() alone.
  it("rejects an invite sent without the admin's own password", async () => {
    queueRole("admin");
    const res = await POST(
      new NextRequest("http://localhost/api/v3/admin/staff-invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", role: "admin" }),
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/re-enter your password/i);
    // Only requireAdmin's lookup ran: nothing was written.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects an invite sent with the wrong password", async () => {
    queueRole("admin");
    queueAdminPassword();
    const res = await POST(
      postRequest({
        email: "new@example.com",
        role: "admin",
        currentAdminPassword: "wrong-pw",
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/password is incorrect/i);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/admin/staff-invites — super_admin account protection", () => {
  it("refuses to invite an existing super_admin's email into a lower role (would silently demote them on accept)", async () => {
    queueRole("admin"); // caller: a plain admin, not super_admin
    queueAdminPassword();
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
    // Three queries ran: requireAdmin's role lookup, the re-auth password
    // lookup, and the existingUser lookup. No CREATE TABLE: the route no
    // longer runs staff_invites' DDL per request (AUDIT-013#schema-02).
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockLogAction).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("still allows inviting an existing non-super_admin account (the guard only blocks super_admin targets)", async () => {
    queueRole("super_admin", 1);
    queueAdminPassword();
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
    queueAdminPassword();
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
    queueAdminPassword();
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
    queueAdminPassword();
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
    // Index 4, not 3: the re-auth password lookup runs between requireAdmin
    // and the existingUser lookup.
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
    queueAdminPassword();
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingUser
    mockQuery.mockResolvedValueOnce({ rows: [] }); // existingInvite
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 501 }] }); // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // inviterRes
    mockSendEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(
      postRequest({ email: "new@example.com", role: "support" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /api/v3/admin/staff-invites — authorization", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    // requireAdmin returns before any table lookup runs.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a moderator (below the admin tier requireAdmin enforces)", async () => {
    queueRole("moderator");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects a support account", async () => {
    queueRole("support");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v3/admin/staff-invites — listing", () => {
  it("returns only pending (unaccepted, unexpired) invites for an admin", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          email: "pending@example.com",
          role: "support",
          created_at: "2026-08-18T00:00:00.000Z",
          expires_at: "2026-08-25T00:00:00.000Z",
          invited_by_name: "Root Admin",
          invited_by_email: "root@example.com",
        },
      ],
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.invites).toHaveLength(1);
    expect(json.invites[0].email).toBe("pending@example.com");

    // The listing query filters to still-actionable rows only.
    const selectCall = mockQuery.mock.calls[1];
    expect(selectCall[0]).toContain("FROM staff_invites");
    expect(selectCall[0]).toContain("accepted_at IS NULL");
    expect(selectCall[0]).toContain("expires_at > NOW()");
  });

  it("returns an empty list when nothing is pending", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no pending invites

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.invites).toEqual([]);
  });
});

describe("DELETE /api/v3/admin/staff-invites — authorization", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await DELETE(deleteRequest({ id: 7 }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a moderator (below the admin tier requireAdmin enforces)", async () => {
    queueRole("moderator");
    const res = await DELETE(deleteRequest({ id: 7 }));
    expect(res.status).toBe(401);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v3/admin/staff-invites — revoke", () => {
  it("rejects a missing or non-numeric invite id", async () => {
    queueRole("admin");
    const res = await DELETE(deleteRequest({ id: "not-a-number" }));
    expect(res.status).toBe(400);
    // Only requireAdmin's own lookup ran; no table touch, no delete.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("deletes a pending invite row and audit-logs the revoke", async () => {
    queueRole("admin", 1);
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: "pending@example.com", role: "support" }],
    }); // DELETE ... RETURNING

    const res = await DELETE(deleteRequest({ id: 7 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, id: 7 });

    // The revoke only ever removes a still-pending row.
    const deleteCall = mockQuery.mock.calls[1];
    expect(deleteCall[0]).toContain("DELETE FROM staff_invites");
    expect(deleteCall[0]).toContain("accepted_at IS NULL");
    expect(deleteCall[1]).toEqual([7]);

    expect(mockLogAction).toHaveBeenCalledWith(
      1,
      null,
      "staff_invite_revoked",
      expect.stringContaining("pending@example.com"),
      "127.0.0.1",
    );
  });

  it("returns 404 when no pending invite matches that id", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE matched nothing

    const res = await DELETE(deleteRequest({ id: 999 }));
    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});
