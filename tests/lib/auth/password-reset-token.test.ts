import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";

/**
 * The one place a password reset token is minted, for forgot-password and the
 * admin "send reset link" action. The pool is faked, so these prove which
 * statements run on which client and in what order; what Postgres does with
 * them under concurrency is tests/integration/reset-token-replace.test.ts.
 */

const SECRET = "password-reset-token-test-secret";
vi.stubEnv("AUTH_SECRET", SECRET);
afterAll(() => {
  vi.unstubAllEnvs();
});

const statements: { sql: string; params: unknown[] }[] = [];
let failOn: string | null = null;
const release = vi.fn();
const connect = vi.fn(async () => ({
  query: async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params });
    if (failOn && sql.startsWith(failOn)) throw new Error("insert failed");
    return { rows: [], rowCount: 1 };
  },
  release,
}));
const poolQuery = vi.fn();

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (...args: unknown[]) => poolQuery(...args),
    connect: () => connect(),
  },
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) =>
    key === "PASSWORD_RESET_HOURS" ? 2 : undefined,
}));

const { issueResetLinkToken } = await import("@/lib/auth/password-reset-token");

beforeEach(() => {
  statements.length = 0;
  failOn = null;
  release.mockClear();
  connect.mockClear();
  poolQuery.mockClear();
});

describe("issueResetLinkToken", () => {
  it("replaces the account's token in one transaction behind a per-account lock", async () => {
    await issueResetLinkToken(42);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(poolQuery).not.toHaveBeenCalled();
    expect(statements.map((s) => s.sql)).toEqual([
      "BEGIN",
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      "DELETE FROM password_reset_tokens WHERE user_id = $1",
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      "COMMIT",
    ]);
    expect(statements[1].params).toEqual(["password-reset-token:42"]);
    expect(statements[2].params).toEqual([42]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("returns the raw token and stores only its keyed digest, expiring after the configured hours", async () => {
    const before = Date.now();
    const token = await issueResetLinkToken(42);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [userId, storedHash, expiresAt] = statements[3].params as [
      number,
      string,
      Date,
    ];
    expect(userId).toBe(42);
    expect(storedHash).toBe(
      createHmac("sha256", SECRET).update(token).digest("hex"),
    );
    expect(JSON.stringify(statements)).not.toContain(token);
    const hours = (expiresAt.getTime() - before) / (60 * 60 * 1000);
    expect(hours).toBeGreaterThanOrEqual(2);
    expect(hours).toBeLessThan(2.01);
  });

  it("mints a different token every call", async () => {
    const a = await issueResetLinkToken(42);
    const b = await issueResetLinkToken(42);
    expect(a).not.toBe(b);
  });

  // A failure after the DELETE must not commit it on its own: the account
  // would be left with no link while the request reports an error.
  it("rolls back, releases the client and rethrows when a statement fails", async () => {
    failOn = "INSERT INTO password_reset_tokens";

    await expect(issueResetLinkToken(42)).rejects.toThrow("insert failed");

    const sql = statements.map((s) => s.sql);
    expect(sql).toContain("ROLLBACK");
    expect(sql).not.toContain("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("still releases the client and reports the original error when the rollback fails too", async () => {
    connect.mockImplementationOnce(async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (sql.startsWith("INSERT")) throw new Error("insert failed");
        if (sql === "ROLLBACK") throw new Error("connection lost");
        return { rows: [], rowCount: 1 };
      },
      release,
    }));

    await expect(issueResetLinkToken(42)).rejects.toThrow("insert failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
