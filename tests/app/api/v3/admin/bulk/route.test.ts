/**
 * Route-level tests for POST /api/v3/admin/bulk (AUDIT-010 bulk user
 * operations: set_role/disable/delete across a selected set of users).
 *
 * requireAdmin() (lib/auth/authorization.ts) runs for real -- only
 * getSession and the database are mocked -- so the actual admin-tier gate
 * (user/support/moderator all rejected, admin/super_admin allowed) is
 * exercised, not assumed. verifyPassword (real scrypt) also runs for real
 * for the password re-auth gate, per this repo's rule against mocking
 * below the network/DB boundary (see tests/lib/auth/password-hash.test.ts).
 *
 * deleteUserAccountData, syncPlanForRoleChange, and
 * deleteAvatarFilesIfLocal are mocked at their module boundaries: each has
 * its own dedicated suite (tests/lib/auth/account-deletion.test.ts,
 * tests/lib/billing/staff-plan.test.ts), so this suite only needs to prove
 * the route calls them with the right arguments, inside the right
 * transaction, for the right target.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
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

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  adminAccountChangeEmail: vi.fn(() => ({
    subject: "s",
    text: "t",
    html: "<p>h</p>",
  })),
}));

const mockDeleteAvatarFilesIfLocal = vi.fn();
vi.mock("@/lib/uploads/avatar-storage", () => ({
  deleteAvatarFilesIfLocal: (...args: unknown[]) =>
    mockDeleteAvatarFilesIfLocal(...args),
}));

const mockSyncPlanForRoleChange = vi.fn();
vi.mock("@/lib/billing/staff-plan", () => ({
  syncPlanForRoleChange: (...args: unknown[]) =>
    mockSyncPlanForRoleChange(...args),
}));

const mockDeleteUserAccountData = vi.fn();
vi.mock("@/lib/auth/account-deletion", () => ({
  deleteUserAccountData: (...args: unknown[]) =>
    mockDeleteUserAccountData(...args),
}));

const routeModule = await import("@/app/api/v3/admin/bulk/route");
const { POST } = routeModule;
const { hashPassword } = await import("@/lib/auth/password-hash");

const ADMIN_PASSWORD = "correct-admin-password-42!";
let adminHash: string;

beforeAll(async () => {
  adminHash = await hashPassword(ADMIN_PASSWORD);
}, 20000);

/** requireAdmin's own `SELECT id, role FROM users WHERE id = $1` lookup --
 * must be queued first, before any other query, for every request. */
function queueAdmin(role: string | null, id = 2) {
  mockGetSession.mockResolvedValue({
    userId: id,
    email: "caller@example.com",
    name: "Caller",
    tosAcceptedAt: null,
    role: "unused-overwritten-by-requireAdmin",
  });
  mockQuery.mockResolvedValueOnce({ rows: role ? [{ id, role }] : [] });
}

/** The route's own re-auth lookup of the ACTING admin's password hash. */
function queueAdminPasswordRow(hash: string | null, overrides = {}) {
  mockQuery.mockResolvedValueOnce({
    rows: hash
      ? [
          {
            password_hash: hash,
            name: "Caller",
            email: "caller@example.com",
            ...overrides,
          },
        ]
      : [],
  });
}

/** The per-target `SELECT email, name, role, unsubscribe_token ...` lookup. */
function queueTarget(target: Record<string, unknown> | null) {
  mockQuery.mockResolvedValueOnce({ rows: target ? [target] : [] });
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/admin/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Queues everything needed for a fully-authorized request up through the
 * password gate, leaving only per-target queries to be queued by the test. */
function authorizedRequest() {
  queueAdmin("admin");
  mockCheckRateLimit.mockResolvedValueOnce({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  });
  queueAdminPasswordRow(adminHash);
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
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
  mockSyncPlanForRoleChange.mockReset();
  mockSyncPlanForRoleChange.mockResolvedValue(undefined);
  mockDeleteUserAccountData.mockReset();
  mockDeleteUserAccountData.mockResolvedValue(undefined);
});

describe("module shape", () => {
  it("only exports POST", () => {
    const mod = routeModule as unknown as Record<string, unknown>;
    expect(mod.GET).toBeUndefined();
    expect(mod.PATCH).toBeUndefined();
    expect(mod.DELETE).toBeUndefined();
    expect(mod.PUT).toBeUndefined();
  });
});

describe("POST /api/v3/admin/bulk — authorization", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(request({ action: "disable", userIds: [5] }));
    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a plain user", async () => {
    queueAdmin("user");
    const res = await POST(request({ action: "disable", userIds: [5] }));
    expect(res.status).toBe(403);
  });

  it("rejects support (view-only, same as the single-user route)", async () => {
    queueAdmin("support");
    const res = await POST(request({ action: "disable", userIds: [5] }));
    expect(res.status).toBe(403);
  });

  it("rejects moderator — none of set_role/disable/delete are in the single-user route's modActions allow-list", async () => {
    queueAdmin("moderator");
    const res = await POST(request({ action: "disable", userIds: [5] }));
    expect(res.status).toBe(403);
  });

  it("allows admin through to validation", async () => {
    queueAdmin("admin");
    const res = await POST(request({ action: "disable", userIds: [] }));
    // Gets past the 403 gate and fails on empty userIds instead.
    expect(res.status).toBe(400);
  });

  it("allows super_admin through to validation", async () => {
    queueAdmin("super_admin");
    const res = await POST(request({ action: "disable", userIds: [] }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v3/admin/bulk — request validation", () => {
  it("rejects a missing action", async () => {
    queueAdmin("admin");
    const res = await POST(request({ userIds: [5] }));
    expect(res.status).toBe(400);
  });

  it("rejects an action outside the 3-action allow-list", async () => {
    queueAdmin("admin");
    const res = await POST(request({ action: "make_admin", userIds: [5] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Invalid or missing action/);
  });

  it("rejects empty userIds", async () => {
    queueAdmin("admin");
    const res = await POST(request({ action: "disable", userIds: [] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/No valid userIds/);
  });

  it("filters out non-integer/negative ids and 400s if nothing valid remains", async () => {
    queueAdmin("admin");
    const res = await POST(
      request({ action: "disable", userIds: [-1, 0, "abc", null] }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects more than the max batch size", async () => {
    queueAdmin("admin");
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 100);
    const res = await POST(request({ action: "disable", userIds: tooMany }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Cannot target more than/);
  });

  it("rejects set_role with a missing role", async () => {
    queueAdmin("admin");
    const res = await POST(request({ action: "set_role", userIds: [5] }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/Invalid role/);
  });

  it("rejects set_role targeting super_admin — that role is un-assignable through any admin-panel path", async () => {
    queueAdmin("admin");
    const res = await POST(
      request({ action: "set_role", userIds: [5], role: "super_admin" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unparseable JSON body", async () => {
    queueAdmin("admin");
    const req = new NextRequest("http://localhost/api/v3/admin/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v3/admin/bulk — password gate", () => {
  it("rejects a request with no currentAdminPassword", async () => {
    queueAdmin("admin");
    const res = await POST(request({ action: "disable", userIds: [5] }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/Re-enter your password/);
  });

  it("is rate limited before touching the database for the password check", async () => {
    queueAdmin("admin");
    mockCheckRateLimit.mockReset();
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [5],
        currentAdminPassword: "whatever",
      }),
    );
    expect(res.status).toBe(429);
  });

  it("rejects an incorrect password", async () => {
    queueAdmin("admin");
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    });
    queueAdminPasswordRow(adminHash);
    const res = await POST(
      request({
        action: "disable",
        userIds: [5],
        currentAdminPassword: "totally-wrong",
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toMatch(/incorrect/);
  }, 20000);

  it("accepts the correct password and proceeds", async () => {
    authorizedRequest();
    queueTarget({
      email: "t@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [5],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
  }, 20000);
});

describe("POST /api/v3/admin/bulk — per-target protection", () => {
  it("never lets the caller target their own account, even alongside valid targets", async () => {
    authorizedRequest();
    queueTarget({
      email: "other@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [2, 6], // 2 === caller's own id from queueAdmin()
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.succeeded).toBe(1);
    expect(json.failed).toBe(1);
    const selfResult = json.results.find(
      (r: { userId: number }) => r.userId === 2,
    );
    expect(selfResult.ok).toBe(false);
    expect(selfResult.error).toMatch(/own account/);
  }, 20000);

  it("protects the owner account (user id 1) from a non-owner admin", async () => {
    authorizedRequest();
    const res = await POST(
      request({
        action: "disable",
        userIds: [1],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/protected/);
  }, 20000);

  it("refuses to modify a super_admin target", async () => {
    authorizedRequest();
    queueTarget({
      email: "root@example.com",
      name: null,
      role: "super_admin",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [9],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/cannot be modified/);
  }, 20000);

  it("reports a per-user 'not found' without failing the whole batch", async () => {
    authorizedRequest();
    queueTarget(null); // user 5 not found
    queueTarget({
      email: "real@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    }); // user 6 exists
    const res = await POST(
      request({
        action: "disable",
        userIds: [5, 6],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.succeeded).toBe(1);
    expect(json.failed).toBe(1);
    expect(
      json.results.find((r: { userId: number }) => r.userId === 5).error,
    ).toMatch(/not found/);
  }, 20000);

  it("dedupes repeated ids in the request", async () => {
    authorizedRequest();
    queueTarget({
      email: "t@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [7, 7, 7],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.results).toHaveLength(1);
  }, 20000);
});

describe("POST /api/v3/admin/bulk — set_role", () => {
  it("updates the role, syncs the staff plan, and logs the change", async () => {
    authorizedRequest();
    queueTarget({
      email: "t@example.com",
      name: "Target",
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "set_role",
        userIds: [5],
        role: "moderator",
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.results[0].ok).toBe(true);
    expect(mockSyncPlanForRoleChange).toHaveBeenCalledWith(
      5,
      "user",
      "moderator",
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "set_role",
      expect.stringContaining("moderator"),
      "127.0.0.1",
    );
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  }, 20000);

  it("skips the email when notifyUser is false", async () => {
    authorizedRequest();
    queueTarget({
      email: "t@example.com",
      name: "Target",
      role: "user",
      unsubscribe_token: null,
    });
    await POST(
      request({
        action: "set_role",
        userIds: [5],
        role: "moderator",
        notifyUser: false,
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  }, 20000);
});

describe("POST /api/v3/admin/bulk — disable", () => {
  it("sets disabled_at and revokes sessions for each target", async () => {
    authorizedRequest();
    queueTarget({
      email: "t@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "disable",
        userIds: [5],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    const sqlCalls = mockQuery.mock.calls.map((c) => c[0] as string);
    expect(sqlCalls.some((sql) => sql.includes("disabled_at = NOW()"))).toBe(
      true,
    );
    expect(sqlCalls.some((sql) => sql.includes("DELETE FROM sessions"))).toBe(
      true,
    );
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      5,
      "disable_user",
      expect.any(String),
      "127.0.0.1",
    );
  }, 20000);
});

describe("POST /api/v3/admin/bulk — delete", () => {
  it("runs deleteUserAccountData inside a BEGIN/COMMIT transaction and cleans up the avatar", async () => {
    authorizedRequest();
    queueTarget({
      email: "gone@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    const res = await POST(
      request({
        action: "delete",
        userIds: [5],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.results[0].ok).toBe(true);
    expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
    expect(mockClientQuery).toHaveBeenCalledWith("COMMIT");
    expect(mockDeleteUserAccountData).toHaveBeenCalledWith(
      expect.anything(),
      5,
    );
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(5);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    // target_user_id is null -- the row is already gone by the time the
    // audit log entry is written, see the route's own comment.
    expect(mockLogAction).toHaveBeenCalledWith(
      2,
      null,
      "delete_account",
      expect.stringContaining("gone@example.com"),
      "127.0.0.1",
    );
  }, 20000);

  it("rolls back and reports a per-user failure if the deletion transaction throws, without aborting the rest of the batch", async () => {
    authorizedRequest();
    queueTarget({
      email: "fails@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    queueTarget({
      email: "succeeds@example.com",
      name: null,
      role: "user",
      unsubscribe_token: null,
    });
    mockDeleteUserAccountData.mockRejectedValueOnce(new Error("db exploded"));
    const res = await POST(
      request({
        action: "delete",
        userIds: [5, 6],
        currentAdminPassword: ADMIN_PASSWORD,
      }),
    );
    const json = await res.json();
    expect(json.succeeded).toBe(1);
    expect(json.failed).toBe(1);
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
  }, 20000);
});
