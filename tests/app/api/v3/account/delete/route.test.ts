/**
 * Route-level tests for POST /api/v3/account/delete.
 *
 * The database, rate limiter, and client-IP lookup are mocked (network/DB
 * boundary). verifyPassword runs for real (real scrypt, real cost) via
 * importOriginal on @/lib/auth — only getSession/destroySession are
 * overridden — per this repo's rule against mocking below the network/DB
 * boundary (tests/README.md).
 *
 * The password check runs as a plain pool.query call, but the delete itself
 * (GDPR audit, 2026-08: security_alerts.resolved_by and
 * system_settings.updated_by have no ON DELETE clause and must be nulled
 * out in the same transaction as DELETE FROM users) runs inside a
 * pool.connect() transaction, so both boundaries are mocked here.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterEach,
  vi,
} from "vitest";

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

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
const mockDestroySession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: () => mockGetSession(),
    destroySession: (...args: unknown[]) => mockDestroySession(...args),
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

// Mocked at this module boundary: the real fs behavior of
// deleteAvatarFilesIfLocal has its own dedicated suite
// (tests/lib/uploads/avatar-storage.test.ts). This suite only needs to
// prove self-deletion calls it after the account row is gone.
const mockDeleteAvatarFilesIfLocal = vi.fn();
vi.mock("@/lib/uploads/avatar-storage", () => ({
  deleteAvatarFilesIfLocal: (...args: unknown[]) =>
    mockDeleteAvatarFilesIfLocal(...args),
}));

// Stripe is the network boundary. Null by default: most of this suite is about
// the delete itself on a deployment with no billing configured.
const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { POST } = await import("@/app/api/v3/account/delete/route");
const { hashPassword } = await import("@/lib/auth/password-hash");
const { encryptApiKey } = await import("@/lib/auth/crypto");

const REAL_PASSWORD = "correct horse battery staple 42!";
let realHash: string;

beforeAll(async () => {
  realHash = await hashPassword(REAL_PASSWORD);
}, 20000);

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockClear();
  mockClientQuery.mockReset();
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockClientRelease.mockReset();
  mockGetSession.mockReset();
  mockDestroySession.mockReset();
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 4,
    retryAfterSeconds: 0,
  });
  mockGetSession.mockResolvedValue({ userId: 11 });
  mockDeleteAvatarFilesIfLocal.mockReset();
  mockDeleteAvatarFilesIfLocal.mockResolvedValue(undefined);
  mockGetStripe.mockReset();
  mockGetStripe.mockReturnValue(null);
});

function deleteRequest(body: unknown): Request {
  return new Request("http://localhost/api/v3/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v3/account/delete", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(deleteRequest({ currentPassword: "x" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 120,
    });
    const res = await POST(deleteRequest({ currentPassword: "x" }));
    expect(res.status).toBe(429);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockDestroySession).not.toHaveBeenCalled();
  });

  it("requires currentPassword in the body when the account has a password set", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    const res = await POST(deleteRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects deletion (fails closed) when the user row is missing entirely", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/incorrect/);
  });

  it("skips the password check entirely for an OAuth-only account with no password set, using only the frontend's DELETE confirmation", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: null }] });
    const res = await POST(deleteRequest({})); // no currentPassword needed
    expect(res.status).toBe(200);
    expect(mockDestroySession).toHaveBeenCalledTimes(1);
  }, 20000);

  it("rejects deletion when the password is wrong (real verifyPassword)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    const res = await POST(
      deleteRequest({ currentPassword: "definitely-not-it" }),
    );
    expect(res.status).toBe(400);
    expect(mockDestroySession).not.toHaveBeenCalled();
  }, 20000);

  it("deletes the account and destroys the session on a correct password", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] }); // SELECT
    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));
    expect(res.status).toBe(200);
    // Uses the shared lib/auth/account-deletion.ts sequence (also exercised
    // directly by tests/lib/auth/account-deletion.test.ts) -- this route's
    // own test only needs to confirm it's wired up: BEGIN first, the
    // user row deleted somewhere in the middle, COMMIT last.
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery).toHaveBeenLastCalledWith("COMMIT");
    const calls = mockClientQuery.mock.calls;
    expect(
      calls.some(
        ([sql, params]) =>
          typeof sql === "string" &&
          sql.includes("DELETE FROM users") &&
          Array.isArray(params) &&
          params[0] === 11,
      ),
    ).toBe(true);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockDestroySession).toHaveBeenCalledTimes(1);
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(11);
  }, 20000);

  it("nulls the non-cascading security_alerts.resolved_by and system_settings.updated_by references before deleting the user (GDPR audit: these two columns have no ON DELETE clause, so a staff account that resolved an alert or changed a setting would otherwise fail to self-delete)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));

    const calls = mockClientQuery.mock.calls;
    const nullSecurityAlertsIndex = calls.findIndex(
      ([sql]) =>
        sql ===
        "UPDATE security_alerts SET resolved_by = NULL WHERE resolved_by = $1",
    );
    const nullSystemSettingsIndex = calls.findIndex(
      ([sql]) =>
        sql ===
        "UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1",
    );
    const deleteUsersIndex = calls.findIndex(
      ([sql]) => typeof sql === "string" && sql.includes("DELETE FROM users"),
    );
    expect(nullSecurityAlertsIndex).toBeGreaterThanOrEqual(0);
    expect(nullSystemSettingsIndex).toBeGreaterThanOrEqual(0);
    expect(calls[nullSecurityAlertsIndex][1]).toEqual([11]);
    expect(calls[nullSystemSettingsIndex][1]).toEqual([11]);
    // Both nulling steps must land before the user row itself is deleted.
    expect(nullSecurityAlertsIndex).toBeLessThan(deleteUsersIndex);
    expect(nullSystemSettingsIndex).toBeLessThan(deleteUsersIndex);
  }, 20000);

  it("rolls back the transaction, releases the client, and does not destroy the session when the delete step fails", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE security_alerts
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE system_settings
    mockClientQuery.mockRejectedValueOnce(new Error("fk violation")); // DELETE FROM users

    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));

    expect(res.status).toBe(500);
    expect(mockClientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockDestroySession).not.toHaveBeenCalled();
    expect(mockDeleteAvatarFilesIfLocal).not.toHaveBeenCalled();
  }, 20000);

  it("still returns 500 and releases the client even if ROLLBACK itself fails on a dead connection", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE security_alerts
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE system_settings
    mockClientQuery.mockRejectedValueOnce(new Error("fk violation")); // DELETE FROM users
    mockClientQuery.mockRejectedValueOnce(
      new Error("connection already closed"),
    ); // ROLLBACK

    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));

    expect(res.status).toBe(500);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockDestroySession).not.toHaveBeenCalled();
  }, 20000);

  it("returns a 500 (via withErrorHandling) instead of throwing when the DB fails", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));
    expect(res.status).toBe(500);
  }, 20000);

  describe("the Stripe subscription", () => {
    function stripeWith(overrides: {
      list?: ReturnType<typeof vi.fn>;
      retrieve?: ReturnType<typeof vi.fn>;
      cancel?: ReturnType<typeof vi.fn>;
    }) {
      const subscriptions = {
        list: overrides.list ?? vi.fn().mockResolvedValue({ data: [] }),
        retrieve:
          overrides.retrieve ??
          vi.fn().mockResolvedValue({ id: "sub_1", status: "active" }),
        cancel: overrides.cancel ?? vi.fn().mockResolvedValue({}),
      };
      mockGetStripe.mockReturnValue({ subscriptions });
      return subscriptions;
    }

    function queueAccount(billing: {
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
    }) {
      mockQuery.mockResolvedValueOnce({
        rows: [{ password_hash: null, email: "a@b.test", name: "A" }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [billing] });
    }

    it("cancels a live subscription before the account is deleted", async () => {
      const { retrieve, cancel } = stripeWith({});
      queueAccount({
        stripe_subscription_id: "sub_1",
        stripe_customer_id: null,
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(200);
      expect(retrieve).toHaveBeenCalledWith("sub_1");
      expect(cancel).toHaveBeenCalledWith("sub_1");
      expect(mockClientQuery).toHaveBeenCalledWith("BEGIN");
      expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
        mockClientQuery.mock.invocationCallOrder[0],
      );
      expect(mockDestroySession).toHaveBeenCalledTimes(1);
    });

    it("keeps the account and answers a retryable 503 when Stripe will not cancel", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      stripeWith({
        cancel: vi.fn().mockRejectedValue(new Error("stripe is down")),
      });
      queueAccount({
        stripe_subscription_id: "sub_1",
        stripe_customer_id: null,
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      const json = await res.json();
      expect(json.error).toMatch(/not deleted/);
      expect(json.error).toMatch(/try again/i);
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockClientQuery).not.toHaveBeenCalled();
      expect(mockDestroySession).not.toHaveBeenCalled();
      expect(mockDeleteAvatarFilesIfLocal).not.toHaveBeenCalled();
      expect(
        errSpy.mock.calls.some((c) => String(c[0]).startsWith("[billing]")),
      ).toBe(true);
      errSpy.mockRestore();
    });

    it("deletes when the subscription no longer exists in Stripe", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { cancel } = stripeWith({
        retrieve: vi.fn().mockRejectedValue({ code: "resource_missing" }),
      });
      queueAccount({
        stripe_subscription_id: "sub_gone",
        stripe_customer_id: null,
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(200);
      expect(cancel).not.toHaveBeenCalled();
      expect(mockClientQuery).toHaveBeenLastCalledWith("COMMIT");
      errSpy.mockRestore();
    });

    it("never touches Stripe on a deployment with no billing configured", async () => {
      mockGetStripe.mockReturnValue(null);
      mockQuery.mockResolvedValueOnce({
        rows: [{ password_hash: null, email: "a@b.test", name: "A" }],
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(200);
      // The password read and nothing else: no lookup of a subscription. The
      // two provider-token reads are not about billing.
      expect(
        mockQuery.mock.calls.filter(
          ([sql]) => !String(sql).includes("_connections"),
        ),
      ).toHaveLength(1);
      expect(mockClientQuery).toHaveBeenLastCalledWith("COMMIT");
    });

    it("does not cancel anything for a request that fails the password check", async () => {
      const { retrieve, cancel } = stripeWith({});
      mockQuery.mockResolvedValueOnce({
        rows: [{ password_hash: realHash, email: "a@b.test", name: "A" }],
      });

      const res = await POST(deleteRequest({ currentPassword: "not-it" }));

      expect(res.status).toBe(400);
      expect(retrieve).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    }, 20000);
  });

  describe("the super admin account", () => {
    it("refuses to delete a super_admin, whatever the session says, and cancels nothing", async () => {
      const cancel = vi.fn();
      mockGetStripe.mockReturnValue({
        subscriptions: { cancel, list: vi.fn(), retrieve: vi.fn() },
      });
      mockGetSession.mockResolvedValue({ userId: 11, role: "user" });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            password_hash: null,
            email: "root@b.test",
            name: "Root",
            role: "super_admin",
          },
        ],
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/your own account/);
      expect(mockConnect).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
      expect(mockDestroySession).not.toHaveBeenCalled();
    });

    // A staff account owns rows other people depend on, and the admin panel
    // already refuses to delete one without a demotion first.
    it.each(["support", "billing", "ops", "moderator", "admin"])(
      "refuses a %s and deletes nothing",
      async (role) => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ password_hash: null, email: "a@b.test", name: "A", role }],
        });

        const res = await POST(deleteRequest({}));

        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toMatch(/staff/i);
        expect(mockConnect).not.toHaveBeenCalled();
        expect(mockDestroySession).not.toHaveBeenCalled();
      },
    );

    it("still lets a plain user delete their own account", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            password_hash: null,
            email: "a@b.test",
            name: "A",
            role: "user",
          },
        ],
      });

      const res = await POST(deleteRequest({}));

      expect(res.status).toBe(200);
    });
  });
});

/**
 * The token outlived the account: nothing told GitHub or Discord, so a full
 * read/write repo token stayed valid after the row holding it was purged.
 */
describe("POST /api/v3/account/delete: provider tokens", () => {
  function storedRows(sql: string) {
    if (sql.includes("password_hash")) {
      return { rows: [{ password_hash: null, email: "a@b.test", name: "A" }] };
    }
    if (sql.includes("FROM github_connections")) {
      return {
        rows: [{ access_token_encrypted: encryptApiKey("gho_token") }],
      };
    }
    if (sql.includes("FROM discord_connections")) {
      return {
        rows: [
          {
            access_token: encryptApiKey("dc-access"),
            refresh_token: encryptApiKey("dc-refresh"),
          },
        ],
      };
    }
    return { rows: [] };
  }

  const mockFetch = vi.fn();
  const providerEnv = {
    GITHUB_CLIENT_ID: "gh-client",
    GITHUB_CLIENT_SECRET: "gh-secret",
    DISCORD_CLIENT_ID: "dc-client",
    DISCORD_CLIENT_SECRET: "dc-secret",
  };

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    for (const [k, v] of Object.entries(providerEnv)) vi.stubEnv(k, v);
    mockQuery.mockImplementation(async (sql: string) => storedRows(sql));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function callsTo(fragment: string) {
    return mockFetch.mock.calls.filter(([url]) =>
      String(url).includes(fragment),
    );
  }

  it("revokes the GitHub token and both Discord tokens before the purge", async () => {
    let purgeStarted = false;
    mockFetch.mockImplementation(async () => {
      expect(purgeStarted).toBe(false);
      return new Response(null, { status: 200 });
    });
    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === "BEGIN") purgeStarted = true;
      return { rows: [], rowCount: 0 };
    });

    const res = await POST(deleteRequest({}));

    expect(res.status).toBe(200);
    expect(callsTo("api.github.com/applications/gh-client/token")).toHaveLength(
      1,
    );
    expect(callsTo("discord.com/api/oauth2/token/revoke")).toHaveLength(2);
    expect(purgeStarted).toBe(true);
  });

  it("still deletes the account when the providers cannot be reached", async () => {
    const quiet = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockFetch.mockRejectedValue(new Error("network down"));

    const res = await POST(deleteRequest({}));

    expect(res.status).toBe(200);
    expect(mockConnect).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it("revokes nothing when the request is refused", async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes("password_hash")
        ? { rows: [{ password_hash: realHash, email: "a@b.test", name: "A" }] }
        : storedRows(sql),
    );

    const res = await POST(deleteRequest({ currentPassword: "wrong" }));

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/account/delete: the rate-limit sentence", () => {
  it("says how long in words, with no (s)", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 240,
    });

    const res = await POST(deleteRequest({}));
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toContain("4 minutes");
    expect(json.error).not.toContain("(s)");
  });
});
