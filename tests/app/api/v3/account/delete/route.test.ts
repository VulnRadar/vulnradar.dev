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
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

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

const { POST } = await import("@/app/api/v3/account/delete/route");
const { hashPassword } = await import("@/lib/auth/password-hash");

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

  it("requires currentPassword in the body", async () => {
    const res = await POST(deleteRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects deletion when the user row is missing", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/incorrect/);
  });

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
    expect(mockClientQuery).toHaveBeenNthCalledWith(1, "BEGIN");
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("DELETE FROM users"),
      [11],
    );
    expect(mockClientQuery).toHaveBeenLastCalledWith("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockDestroySession).toHaveBeenCalledTimes(1);
    expect(mockDeleteAvatarFilesIfLocal).toHaveBeenCalledWith(11);
  }, 20000);

  it("nulls the non-cascading security_alerts.resolved_by and system_settings.updated_by references before deleting the user (GDPR audit: these two columns have no ON DELETE clause, so a staff account that resolved an alert or changed a setting would otherwise fail to self-delete)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: realHash }] });
    await POST(deleteRequest({ currentPassword: REAL_PASSWORD }));

    expect(mockClientQuery).toHaveBeenNthCalledWith(
      2,
      "UPDATE security_alerts SET resolved_by = NULL WHERE resolved_by = $1",
      [11],
    );
    expect(mockClientQuery).toHaveBeenNthCalledWith(
      3,
      "UPDATE system_settings SET updated_by = NULL WHERE updated_by = $1",
      [11],
    );
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
});
