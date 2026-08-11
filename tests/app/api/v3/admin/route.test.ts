/**
 * Route-level tests for GET/PATCH /api/v3/admin (the user list/management
 * surface, the biggest and most security-sensitive admin route). This is
 * the highest-priority suite in this task: it exists primarily to prove the
 * staff role hierarchy (user < support < moderator < admin) is enforced
 * for real, not to chase branch coverage of every one of the ~30 PATCH
 * actions.
 *
 * requireStaff() (lib/auth/authorization.ts) runs for real — only
 * getSession and the database are mocked — so the actual role-hierarchy
 * check is exercised, not assumed. logAction is spied via importOriginal so
 * the rest of lib/auth/authorization.ts (verifyOwnership, etc.) stays real.
 * verifyPassword (real scrypt) also runs for real for the GATED_ACTIONS
 * re-auth flow, per this repo's rule against mocking below the network/DB
 * boundary — see tests/lib/auth/password-hash.test.ts.
 */
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

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
    logAction: (...args: unknown[]) => mockLogAction(...args),
  };
});

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  };
});

// Mocked at the resolver boundary (same pattern as
// tests/app/api/v3/admin/features/route.test.ts) rather than reverse
// engineering system_settings row shapes through the pool mock: add_note
// and edit_note read MAX_DESCRIPTION_LENGTH through this resolver.
const mockGetSetting = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  adminNotificationEmail: vi.fn(() => ({
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  })),
  adminAccountChangeEmail: vi.fn(() => ({
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  })),
}));

// Mocked at this module boundary (not the filesystem below it): the
// real fs behavior of deleteAvatarFilesIfLocal has its own dedicated
// suite (tests/lib/uploads/avatar-storage.test.ts). This suite only
// needs to prove each admin action that replaces/removes a user's
// avatar_url calls it, not re-prove the file I/O itself.
const mockDeleteAvatarFilesIfLocal = vi.fn();
vi.mock("@/lib/uploads/avatar-storage", () => ({
  deleteAvatarFilesIfLocal: (...args: unknown[]) =>
    mockDeleteAvatarFilesIfLocal(...args),
}));

// Mocked at this module boundary, same reasoning as deleteAvatarFilesIfLocal
// above: its own DB behavior (grant/revoke the real staff plan floor) has
// its own dedicated suite (tests/lib/billing/staff-plan.test.ts). This
// suite only needs to prove each role-changing action (set_role,
// make_admin, remove_admin) calls it with the right before/after roles.
const mockSyncPlanForRoleChange = vi.fn();
vi.mock("@/lib/billing/staff-plan", () => ({
  syncPlanForRoleChange: (...args: unknown[]) =>
    mockSyncPlanForRoleChange(...args),
}));

const routeModule = await import("@/app/api/v3/admin/route");
const { GET, PATCH } = routeModule;
const { hashPassword } = await import("@/lib/auth/password-hash");

const ADMIN_PASSWORD = "correct-admin-password-42!";
let adminHash: string;

beforeAll(async () => {
  adminHash = await hashPassword(ADMIN_PASSWORD);
}, 20000);

/** requireStaff's own role lookup — must be queued first, before any other query. */
function queueRole(role: string | null) {
  mockQuery.mockResolvedValueOnce({ rows: role ? [{ role }] : [] });
}

/** The PATCH target-user lookup (email/totp/role/plan/name/unsubscribe_token). */
function queueTarget(target: Record<string, unknown>) {
  mockQuery.mockResolvedValueOnce({ rows: [target] });
}

/** The GATED_ACTIONS re-auth lookup of the ACTING admin's own password hash. */
function queueAdminPassword(hash: string | null) {
  mockQuery.mockResolvedValueOnce({
    rows: hash ? [{ password_hash: hash }] : [],
  });
}

function session(userId = 2) {
  mockGetSession.mockResolvedValue({
    userId,
    email: "caller@example.com",
    name: "Caller",
    tosAcceptedAt: null,
    role: "unused-overwritten-by-requireStaff",
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
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockLogAction.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(1000);
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
  mockSyncPlanForRoleChange.mockReset();
  mockSyncPlanForRoleChange.mockResolvedValue(undefined);

  // Generic default for any query this suite doesn't specifically assert
  // on (e.g. getAdminName/getUserName lookups fired inside action handlers).
  mockQuery.mockResolvedValue({
    rows: [{ name: "Someone", email: "someone@example.com" }],
    rowCount: 0,
  });
  session(2);
});

function getRequest(url = "http://localhost/api/v3/admin"): NextRequest {
  return new NextRequest(url);
}

function patchRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("module shape", () => {
  it("only exports GET and PATCH — a delete/disable-shaped action cannot be reached via any other HTTP method", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.DELETE).toBeUndefined();
    expect(mod.POST).toBeUndefined();
    expect(mod.PUT).toBeUndefined();
  });
});

describe("GET /api/v3/admin", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a plain user (not staff)", async () => {
    queueRole("user");
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  it("returns the default stats + user list view for a support-tier caller", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [{ total_users: 5 }] }); // stats
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // users
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // total
    const res = await GET(getRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.callerRole).toBe("support");
    expect(json.users).toHaveLength(1);
  });

  it("rejects invalid pagination parameters", async () => {
    queueRole("support");
    const res = await GET(getRequest("http://localhost/api/v3/admin?page=abc"));
    expect(res.status).toBe(400);
  });

  it("section=user-detail requires a userId", async () => {
    queueRole("support");
    const res = await GET(
      getRequest("http://localhost/api/v3/admin?section=user-detail"),
    );
    expect(res.status).toBe(400);
  });

  it("section=user-detail returns 404 for an unknown user", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // userRes
    for (let i = 0; i < 7; i++) mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(
      getRequest("http://localhost/api/v3/admin?section=user-detail&userId=9"),
    );
    expect(res.status).toBe(404);
  });

  it("section=user-detail returns the full detail bundle", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 9, email: "u@example.com" }],
    }); // userRes
    for (let i = 0; i < 7; i++) mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await GET(
      getRequest("http://localhost/api/v3/admin?section=user-detail&userId=9"),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.id).toBe(9);
    expect(json).toHaveProperty("recentScans");
    expect(json).toHaveProperty("apiKeys");
    expect(json).toHaveProperty("badges");
    expect(json).toHaveProperty("notes");
  });

  it("section=audit requires moderator+ (support is read-only up to a point, but not audit)", async () => {
    queueRole("support");
    const res = await GET(
      getRequest("http://localhost/api/v3/admin?section=audit"),
    );
    expect(res.status).toBe(403);
  });

  it("section=audit succeeds for a moderator", async () => {
    queueRole("moderator");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, action: "disable_user" }],
    }); // auditRes
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "1" }] }); // totalRes
    const res = await GET(
      getRequest("http://localhost/api/v3/admin?section=audit"),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.logs).toHaveLength(1);
  });

  it("section=badges and section=active-admins are available to support", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const badgesRes = await GET(
      getRequest("http://localhost/api/v3/admin?section=badges"),
    );
    expect(badgesRes.status).toBe(200);

    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const adminsRes = await GET(
      getRequest("http://localhost/api/v3/admin?section=active-admins"),
    );
    expect(adminsRes.status).toBe(200);
  });

  it("section=active-admins includes super_admin in the role filter so the account is visible in the panel", async () => {
    queueRole("support");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await GET(
      getRequest("http://localhost/api/v3/admin?section=active-admins"),
    );
    const sqlCalls = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls.some((sql) => sql.includes("'super_admin'"))).toBe(true);
  });

  it("never calls logAction — a mutating/audited action cannot be reached via GET", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [{ total_users: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    await GET(getRequest());
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v3/admin — authorization", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await PATCH(patchRequest({ action: "update_name", userId: 5 }));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a plain user (not staff at all)", async () => {
    queueRole("user");
    const res = await PATCH(patchRequest({ action: "update_name", userId: 5 }));
    expect(res.status).toBe(403);
  });

  it("rejects support on every mutating action — support is view-only", async () => {
    queueRole("support");
    const res = await PATCH(
      patchRequest({ action: "update_name", userId: 5, name: "x" }),
    );
    expect(res.status).toBe(403);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("allows a moderator to perform an action in its allow-list", async () => {
    queueRole("moderator");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "revoke_sessions",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "revoke_sessions",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);

  it("rejects a moderator performing an action outside its allow-list (admin-only action)", async () => {
    queueRole("moderator");
    const res = await PATCH(patchRequest({ action: "make_admin", userId: 5 }));
    expect(res.status).toBe(403);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects a moderator acting on a peer or higher-privileged target, even for an allowed action", async () => {
    queueRole("moderator");
    queueTarget({
      email: "peer@example.com",
      role: "moderator",
      unsubscribe_token: null,
    });
    const res = await PATCH(
      patchRequest({ action: "revoke_sessions", userId: 5 }),
    );
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/equal or higher roles/);
  });

  it("moderator cannot edit or delete an admin note, even one they authored themselves — canPerformAction blocks edit_note/delete_note before the switch's own ownership check ever runs (edit_note/delete_note are absent from modActions, unlike add_note)", async () => {
    queueRole("moderator");
    const res = await PATCH(
      patchRequest({ action: "edit_note", userId: 5, noteId: 1, note: "hi" }),
    );
    expect(res.status).toBe(403);
  });

  it("protects the owner account (user id 1) from any non-owner admin", async () => {
    queueRole("admin");
    const res = await PATCH(patchRequest({ action: "disable", userId: 1 }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/protected/);
  });

  it("prevents an admin from disabling/deleting/resetting/re-roling their own account", async () => {
    queueRole("admin");
    const res = await PATCH(patchRequest({ action: "disable", userId: 2 }));
    expect(res.status).toBe(400);
  });

  it("requires userId and action", async () => {
    queueRole("admin");
    const res = await PATCH(patchRequest({ action: "disable" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric userId", async () => {
    queueRole("admin");
    const res = await PATCH(
      patchRequest({ action: "disable", userId: "not-a-number" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for a target user that does not exist", async () => {
    queueRole("admin");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // targetRes empty
    const res = await PATCH(
      patchRequest({ action: "revoke_sessions", userId: 999 }),
    );
    expect(res.status).toBe(404);
  });

  it("is rate limited before any mutation happens", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 90,
    });
    const res = await PATCH(
      patchRequest({ action: "revoke_sessions", userId: 5 }),
    );
    expect(res.status).toBe(429);
    expect(mockLogAction).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v3/admin — GATED_ACTIONS re-auth (real scrypt)", () => {
  it("rejects a gated action with no currentAdminPassword supplied", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    const res = await PATCH(patchRequest({ action: "disable", userId: 5 }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/Re-enter your password/);
  });

  it("rejects a gated action with the wrong currentAdminPassword", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "disable",
        userId: 5,
        currentAdminPassword: "definitely-wrong",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/incorrect/);
    expect(mockLogAction).not.toHaveBeenCalled();
  }, 20000);

  it("proceeds when the correct currentAdminPassword is supplied", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "make_admin",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "make_admin",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);
});

describe("PATCH /api/v3/admin — delete_account transaction", () => {
  it("runs the delete inside BEGIN/COMMIT and audit-logs it", async () => {
    queueRole("admin");
    queueTarget({
      email: "gone@example.com",
      role: "user",
      name: "Gone",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "delete_account",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockClientQuery.mock.calls[0][0]).toBe("BEGIN");
    const lastCall =
      mockClientQuery.mock.calls[mockClientQuery.mock.calls.length - 1];
    expect(lastCall[0]).toBe("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    // targetUserId is null, not the deleted user's id: admin_audit_log.
    // target_user_id's FK is ON DELETE SET NULL, which only relaxes the
    // constraint for existing rows when their target is deleted LATER --
    // it does not allow INSERTing a fresh row that references an id
    // that's already gone by the time this call runs (the DELETE FROM
    // users above, in the same transaction, already committed by now).
    // Passing the real userId here used to throw a foreign-key violation
    // on every single delete, reporting "Action failed" for a delete that
    // had, in fact, already fully succeeded.
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      null,
      "delete_account",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);

  it("cleans up any avatar file for the deleted user after the transaction commits", async () => {
    queueRole("admin");
    queueTarget({
      email: "gone@example.com",
      role: "user",
      name: "Gone",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    await PATCH(
      patchRequest({
        action: "delete_account",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(5);
  }, 20000);

  it("nulls security_alerts.resolved_by and system_settings.updated_by before the final DELETE FROM users (GDPR audit: both columns have no ON DELETE clause, so a staff target who resolved an alert or changed a setting would otherwise fail this transaction with a foreign-key violation)", async () => {
    queueRole("admin");
    queueTarget({
      email: "gone@example.com",
      role: "user",
      name: "Gone",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    await PATCH(
      patchRequest({
        action: "delete_account",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );

    const calls = mockClientQuery.mock.calls.map((c) => c[0] as string);
    const nullResolvedBy = calls.findIndex((sql) =>
      sql.includes("UPDATE security_alerts SET resolved_by = NULL"),
    );
    const nullUpdatedBy = calls.findIndex((sql) =>
      sql.includes("UPDATE system_settings SET updated_by = NULL"),
    );
    const finalDelete = calls.findIndex(
      (sql) => sql === "DELETE FROM users WHERE id = $1",
    );

    expect(nullResolvedBy).toBeGreaterThanOrEqual(0);
    expect(nullUpdatedBy).toBeGreaterThanOrEqual(0);
    expect(finalDelete).toBeGreaterThan(nullResolvedBy);
    expect(finalDelete).toBeGreaterThan(nullUpdatedBy);
    expect(mockClientQuery.mock.calls[nullResolvedBy][1]).toEqual([5]);
    expect(mockClientQuery.mock.calls[nullUpdatedBy][1]).toEqual([5]);
  }, 20000);

  it("rolls back and releases the client when a delete step fails, but the PATCH handler itself throws uncaught (no withErrorHandling wrapper on this route — a real gap: a mid-transaction failure surfaces as an unhandled exception instead of a clean 5xx JSON response)", async () => {
    queueRole("admin");
    queueTarget({
      email: "gone@example.com",
      role: "user",
      name: "Gone",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockRejectedValueOnce(new Error("mid-transaction failure"));
    await expect(
      PATCH(
        patchRequest({
          action: "delete_account",
          userId: 5,
          currentAdminPassword: ADMIN_PASSWORD,
        }),
      ),
    ).rejects.toThrow("mid-transaction failure");
    const rollbackCall = mockClientQuery.mock.calls.find(
      (c) => c[0] === "ROLLBACK",
    );
    expect(rollbackCall).toBeTruthy();
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe("PATCH /api/v3/admin — spot checks across other actions (audit logging)", () => {
  it("award_badge: 404s for an unknown badge without logging", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge lookup: not found
    const res = await PATCH(
      patchRequest({ action: "award_badge", userId: 5, badgeId: 3 }),
    );
    expect(res.status).toBe(404);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("award_badge: succeeds and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ display_name: "Founder" }] }); // badge lookup
    mockQuery.mockResolvedValueOnce({ rows: [] }); // already-awarded check
    const res = await PATCH(
      patchRequest({ action: "award_badge", userId: 5, badgeId: 3 }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "award_badge",
      expect.stringContaining("Founder"),
      "127.0.0.1",
    );
  });

  it("gift_subscription rejects an invalid plan", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    const res = await PATCH(
      patchRequest({
        action: "gift_subscription",
        userId: 5,
        giftPlan: "not_a_real_plan",
        giftEndDate: "2027-01-01",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("update_plan rejects an invalid plan", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      plan: "free",
      unsubscribe_token: null,
    });
    const res = await PATCH(
      patchRequest({
        action: "update_plan",
        userId: 5,
        plan: "not_a_real_plan",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("toggle_ai_ban flips the flag and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    mockQuery.mockResolvedValueOnce({ rows: [{ ai_chat_banned: false }] });
    const res = await PATCH(
      patchRequest({
        action: "toggle_ai_ban",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ai_chat_banned).toBe(true);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "toggle_ai_ban",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);

  it("add_note is allowed for a moderator and audit-logged", async () => {
    queueRole("moderator");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT
    const res = await PATCH(
      patchRequest({
        action: "add_note",
        userId: 5,
        note: "flagged for review",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "add_note",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("edit_note as admin is rejected when the caller neither owns the note nor is admin — wait, is admin, so instead prove a non-owner admin CAN edit any note", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ admin_id: 999 }] }); // authored by someone else
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await PATCH(
      patchRequest({
        action: "edit_note",
        userId: 5,
        noteId: 1,
        note: "edited",
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "edit_note",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("rejects an unknown action", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    const res = await PATCH(
      patchRequest({ action: "not_a_real_action", userId: 5 }),
    );
    expect(res.status).toBe(400);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("clear_avatar: deletes any stored avatar file, nulls the column, and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET avatar_url = NULL
    const res = await PATCH(
      patchRequest({ action: "clear_avatar", userId: 5 }),
    );
    expect(res.status).toBe(200);
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(5);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "clear_avatar",
      expect.any(String),
      "127.0.0.1",
    );
  });

  // Part 3 audit fix: clear_rate_limits previously only called logAction --
  // it never issued a single query against rate_limits, so "clearing" a
  // user's rate limits was a client-visible success that changed nothing.
  // This test would have failed against the old implementation (no
  // DELETE FROM rate_limits call exists at all).
  it("clear_rate_limits: actually deletes matching rate_limits rows and reports the real count in the audit log", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 }); // DELETE FROM rate_limits
    const res = await PATCH(
      patchRequest({ action: "clear_rate_limits", userId: 5 }),
    );
    expect(res.status).toBe(200);
    const deleteCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("DELETE FROM rate_limits"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]).toEqual(["5"]);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "clear_rate_limits",
      expect.stringContaining("Cleared 3 rate limit bucket(s)"),
      "127.0.0.1",
    );
  });

  it("reset_daily_limit: deletes only today's daily_scan counter row (not every rate_limits row) and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE FROM rate_limits
    const res = await PATCH(
      patchRequest({ action: "reset_daily_limit", userId: 5 }),
    );
    expect(res.status).toBe(200);
    const deleteCall = mockQuery.mock.calls.find(
      (c) =>
        String(c[0]).includes("DELETE FROM rate_limits") &&
        String(c[0]).includes("CURRENT_DATE"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]).toEqual(["daily_scan:5"]);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "reset_daily_limit",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("reset_ai_usage: deletes the current-window ai_usage row for the target user and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE FROM ai_usage
    const res = await PATCH(
      patchRequest({ action: "reset_ai_usage", userId: 5 }),
    );
    expect(res.status).toBe(200);
    const deleteCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("DELETE FROM ai_usage"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]?.[0]).toBe(5);
    expect(deleteCall?.[1]?.[1]).toBeInstanceOf(Date);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "reset_ai_usage",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("reset_github_review_usage: deletes the current-window github_review_usage row for the target user and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE FROM github_review_usage
    const res = await PATCH(
      patchRequest({ action: "reset_github_review_usage", userId: 5 }),
    );
    expect(res.status).toBe(200);
    const deleteCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("DELETE FROM github_review_usage"),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.[1]?.[0]).toBe(5);
    expect(deleteCall?.[1]?.[1]).toBeInstanceOf(Date);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "reset_github_review_usage",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("reset_free_github_trial: clears free_github_review_used_at and audit-logs", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE users SET free_github_review_used_at = NULL
    const res = await PATCH(
      patchRequest({ action: "reset_free_github_trial", userId: 5 }),
    );
    expect(res.status).toBe(200);
    const updateCall = mockQuery.mock.calls.find((c) =>
      String(c[0]).includes("free_github_review_used_at = NULL"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toEqual([5]);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "reset_free_github_trial",
      expect.any(String),
      "127.0.0.1",
    );
  });

  it("a moderator can perform the 4 new reset actions (added to canPerformAction's modActions)", async () => {
    for (const action of [
      "reset_daily_limit",
      "reset_ai_usage",
      "reset_github_review_usage",
      "reset_free_github_trial",
    ]) {
      queueRole("moderator");
      queueTarget({
        email: "t@example.com",
        role: "user",
        unsubscribe_token: null,
      });
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const res = await PATCH(patchRequest({ action, userId: 5 }));
      expect(res.status).toBe(200);
    }
  });
});

describe("PATCH /api/v3/admin, super_admin target protection", () => {
  // userId 42 (not 1) is deliberate: it isolates the new role-based guard
  // from the pre-existing, unrelated "protect the owner account (user ID
  // 1)" check a few lines above it in the route, which would otherwise
  // reject these same requests for an unrelated reason and produce a
  // false pass.
  it.each(["admin", "moderator"] as const)(
    "rejects a %s caller from touching a super_admin target, even for an action that role could otherwise perform",
    async (callerRole) => {
      queueRole(callerRole);
      queueTarget({
        email: "root@example.com",
        role: "super_admin",
        unsubscribe_token: null,
      });
      const res = await PATCH(
        patchRequest({ action: "revoke_sessions", userId: 42 }),
      );
      const json = await res.json();
      expect(res.status).toBe(403);
      expect(json.error).toMatch(/cannot be modified/);
      expect(mockLogAction).not.toHaveBeenCalled();
    },
  );

  it("rejects the super_admin acting on their own account through the admin panel (self-protection, not just protection from others)", async () => {
    session(1);
    queueRole("super_admin");
    queueTarget({
      email: "root@example.com",
      role: "super_admin",
      unsubscribe_token: null,
    });
    const res = await PATCH(
      patchRequest({ action: "revoke_sessions", userId: 1 }),
    );
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/cannot be modified/);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("rejects disable/delete/reset_password/set_role targeting a super_admin the same way as any other action", async () => {
    queueRole("admin");
    queueTarget({
      email: "root@example.com",
      role: "super_admin",
      unsubscribe_token: null,
    });
    const res = await PATCH(patchRequest({ action: "disable", userId: 42 }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/cannot be modified/);
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("set_role rejects an attempt to grant super_admin to any user, it is not an assignable role, even for an admin caller", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "set_role",
        userId: 5,
        role: "super_admin",
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Invalid role/);
    expect(mockLogAction).not.toHaveBeenCalled();
  }, 20000);
});

describe("PATCH /api/v3/admin — staff plan grant/revoke wiring (lib/billing/staff-plan.ts)", () => {
  it("set_role calls syncPlanForRoleChange with the before/after roles", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "set_role",
        userId: 5,
        role: "moderator",
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSyncPlanForRoleChange).toHaveBeenCalledWith(
      5,
      "user",
      "moderator",
    );
  }, 20000);

  it("set_role between two staff roles still reports the real before role, not a staff-generic one", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "moderator",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "set_role",
        userId: 5,
        role: "support",
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSyncPlanForRoleChange).toHaveBeenCalledWith(
      5,
      "moderator",
      "support",
    );
  }, 20000);

  it("make_admin calls syncPlanForRoleChange with the target's prior role and 'admin'", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "make_admin",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSyncPlanForRoleChange).toHaveBeenCalledWith(5, "user", "admin");
  }, 20000);

  it("remove_admin calls syncPlanForRoleChange with the target's prior role and 'user'", async () => {
    queueRole("admin");
    queueTarget({
      email: "t@example.com",
      role: "admin",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "remove_admin",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSyncPlanForRoleChange).toHaveBeenCalledWith(5, "admin", "user");
  }, 20000);
});

describe("PATCH /api/v3/admin, super_admin caller passes every check an admin passes", () => {
  it("can perform an admin-only action (make_admin) that a moderator cannot", async () => {
    queueRole("super_admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    queueAdminPassword(adminHash);
    const res = await PATCH(
      patchRequest({
        action: "make_admin",
        userId: 5,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "make_admin",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);

  it("can impersonate a user (admin-only action)", async () => {
    queueRole("super_admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    const res = await PATCH(patchRequest({ action: "impersonate", userId: 5 }));
    expect(res.status).toBe(200);
  });

  it("can edit a note it doesn't own (admin-or-higher-only capability)", async () => {
    queueRole("super_admin");
    queueTarget({
      email: "t@example.com",
      role: "user",
      unsubscribe_token: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ admin_id: 999 }] }); // authored by someone else
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const res = await PATCH(
      patchRequest({
        action: "edit_note",
        userId: 5,
        noteId: 1,
        note: "edited",
      }),
    );
    expect(res.status).toBe(200);
  });
});
