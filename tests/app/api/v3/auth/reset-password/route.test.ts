import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeHeaderStore } from "../_test-harness";
import { encryptApiKey } from "@/lib/auth/crypto";

/**
 * Route-level tests for POST /api/v3/auth/reset-password.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. hashPassword, analyzePassword, and checkPasswordRequirements all
 * run for real, so the requirements check runs against the *account's*
 * real email/name pulled from the token's user row, not whatever the
 * request body claims.
 */

const queries: { sql: string; params: unknown[] }[] = [];
// Statements that went to the pool rather than the transaction's client.
const outsideTransaction: string[] = [];

let tokenRow: {
  id: number;
  user_id: number;
  expires_at: string;
  email: string;
  name: string | null;
  totp_enabled: boolean;
  auth_provider?: string | null;
} | null = null;

let deletedTokenIds: number[] = [];
let passwordUpdateCalls: unknown[][] = [];
let tokenUsedCalls: unknown[][] = [];
let sessionDeleteCalls: unknown[][] = [];
let deviceTrustDeleteCalls: unknown[][] = [];
let discordRow: { access_token: string; refresh_token: string } | null = null;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (
    s.includes("FROM password_reset_tokens prt") &&
    s.includes("FOR UPDATE")
  ) {
    return { rows: tokenRow ? [tokenRow] : [] };
  }
  if (s.startsWith("DELETE FROM password_reset_tokens WHERE id = $1")) {
    deletedTokenIds.push(params[0] as number);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET password_hash = $1 WHERE id = $2")) {
    passwordUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE password_reset_tokens SET used_at = NOW()")) {
    tokenUsedCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM sessions WHERE user_id = $1")) {
    sessionDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM device_trust WHERE user_id = $1")) {
    deviceTrustDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM discord_connections WHERE user_id = $1")) {
    return { rows: discordRow ? [discordRow] : [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("SELECT unsubscribe_token FROM users WHERE id")) {
    return { rows: [{ unsubscribe_token: null }] };
  }
  // Zero rows from the limiter's upsert means the bucket is full.
  if (s.startsWith("INSERT INTO rate_limits")) {
    return { rows: [{ count: "1" }] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => {
      outsideTransaction.push(sql.trim());
      return mockQuery(sql, params);
    },
    connect: async () => ({
      query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
      release: () => {},
    }),
  },
}));

const { store: headerStore, state: headerState } = makeHeaderStore();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => headerStore),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { verifyPassword } = await import("@/lib/auth/password-hash");
const { POST } = await import("@/app/api/v3/auth/reset-password/route");

const STRONG_PASSWORD = "Nx8&Qvrmpz3Ldk";

function resetRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validToken(overrides: Partial<NonNullable<typeof tokenRow>> = {}) {
  return {
    id: 5,
    user_id: 42,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    email: "account-owner@example.com",
    name: "Account Owner",
    totp_enabled: false,
    auth_provider: "password",
    ...overrides,
  };
}

beforeEach(async () => {
  // Drain any background setImmediate email sends left pending by the
  // previous test (routes queue the password-changed notification via
  // setImmediate without the response awaiting it) before resetting mocks,
  // so a leftover callback can't fire during the next test and inflate its
  // call count.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  outsideTransaction.length = 0;
  headerState.clear();
  tokenRow = null;
  deletedTokenIds = [];
  passwordUpdateCalls = [];
  tokenUsedCalls = [];
  sessionDeleteCalls = [];
  deviceTrustDeleteCalls = [];
  discordRow = null;
});

describe("POST /api/v3/auth/reset-password", () => {
  // A linked identity is a way in that needs no password. An attacker who
  // linked one keeps the account through a reset unless the reset evicts it.
  describe("linked sign-in providers", () => {
    function evictionSql() {
      return queries.filter(
        (q) => q.sql.startsWith("UPDATE users SET") && /_id = NULL/.test(q.sql),
      );
    }

    it("evicts every linked provider and the Discord connection inside the transaction", async () => {
      tokenRow = validToken({ auth_provider: "password" });

      const res = await POST(
        resetRequest({ token: "t", password: STRONG_PASSWORD }),
      );
      expect(res.status).toBe(200);

      const sql = queries.map((q) => q.sql);
      const begin = sql.indexOf("BEGIN");
      const commit = sql.indexOf("COMMIT");
      const evict = sql.findIndex(
        (q) =>
          q.startsWith("UPDATE users SET") && q.includes("google_id = NULL"),
      );
      const dropDiscord = sql.findIndex((q) =>
        q.startsWith("DELETE FROM discord_connections WHERE user_id = $1"),
      );
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(evict).toBeGreaterThan(begin);
      expect(evict).toBeLessThan(commit);
      expect(dropDiscord).toBeGreaterThan(begin);
      expect(dropDiscord).toBeLessThan(commit);

      const [update] = evictionSql();
      expect(update!.sql).toContain("google_id = NULL");
      expect(update!.sql).toContain("github_id = NULL");
      expect(update!.sql).toContain("discord_id = NULL");
      expect(update!.params).toEqual([42]);
      expect(queries[dropDiscord]!.params).toEqual([42]);
      // The pool and the client share a fake, so the ordering above cannot
      // tell a statement in the transaction from one beside it.
      expect(
        outsideTransaction.filter(
          (q) => q.includes("google_id = NULL") || q.includes("discord_conn"),
        ),
      ).toEqual([]);
    });

    it("clears the profile columns that describe an evicted identity", async () => {
      tokenRow = validToken();

      await POST(resetRequest({ token: "t", password: STRONG_PASSWORD }));

      const [update] = evictionSql();
      for (const column of [
        "google_email",
        "google_name",
        "google_avatar_url",
        "github_email",
        "github_name",
        "github_avatar_url",
        "github_login",
        "discord_email",
        "discord_username",
        "discord_avatar_url",
      ]) {
        expect(update!.sql).toContain(`${column} = NULL`);
      }
    });

    it.each([
      ["google", "google_id", ["github_id", "discord_id"]],
      ["github", "github_id", ["google_id", "discord_id"]],
      ["discord", "discord_id", ["google_id", "github_id"]],
    ])(
      "keeps the identity that created a %s account",
      async (provider, kept, cleared) => {
        tokenRow = validToken({ auth_provider: provider });

        await POST(resetRequest({ token: "t", password: STRONG_PASSWORD }));

        const [update] = evictionSql();
        expect(update!.sql).not.toContain(`${kept} = NULL`);
        for (const column of cleared) {
          expect(update!.sql).toContain(`${column} = NULL`);
        }
      },
    );

    it("still drops the Discord connection on a Discord-created account", async () => {
      // discord_connections is the row /auth/discord?action=login signs in
      // from and can hold a Discord id other than the one that created the
      // account. The creating identity survives on users.discord_id.
      tokenRow = validToken({ auth_provider: "discord" });

      await POST(resetRequest({ token: "t", password: STRONG_PASSWORD }));

      expect(
        queries.some((q) =>
          q.sql.startsWith(
            "DELETE FROM discord_connections WHERE user_id = $1",
          ),
        ),
      ).toBe(true);
    });

    it("revokes the evicted Discord tokens at Discord once the reset has committed", async () => {
      tokenRow = validToken({ auth_provider: "discord" });
      vi.stubEnv("API_KEY_ENCRYPTION_KEY", "a".repeat(64));
      vi.stubEnv("DISCORD_CLIENT_ID", "client");
      vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
      discordRow = {
        access_token: encryptApiKey("evicted-access"),
        refresh_token: encryptApiKey("evicted-refresh"),
      };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => {
          // Revoking has to come after COMMIT: a reset that fails later must
          // leave the connection working.
          expect(queries.map((q) => q.sql)).toContain("COMMIT");
          return new Response(null, { status: 200 });
        });

      try {
        const res = await POST(
          resetRequest({ token: "t", password: STRONG_PASSWORD }),
        );

        expect(res.status).toBe(200);
        const sent = fetchSpy.mock.calls.map(([, init]) =>
          new URLSearchParams(init?.body as URLSearchParams).get("token"),
        );
        expect(sent.sort()).toEqual(["evicted-access", "evicted-refresh"]);
      } finally {
        fetchSpy.mockRestore();
        vi.unstubAllEnvs();
      }
    });

    it("removes the trusted devices in the same transaction", async () => {
      tokenRow = validToken();

      await POST(resetRequest({ token: "t", password: STRONG_PASSWORD }));

      expect(deviceTrustDeleteCalls).toEqual([[42]]);
    });

    it("evicts nothing for a token that does not resolve", async () => {
      tokenRow = null;

      await POST(resetRequest({ token: "t", password: STRONG_PASSWORD }));

      expect(evictionSql()).toHaveLength(0);
      expect(queries.some((q) => q.sql.includes("discord_connections"))).toBe(
        false,
      );
    });
  });

  it("rejects a missing token", async () => {
    const res = await POST(resetRequest({ password: STRONG_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing password", async () => {
    const res = await POST(resetRequest({ token: "sometoken" }));
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than the minimum", async () => {
    const res = await POST(
      resetRequest({ token: "sometoken", password: "short1!" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown or already-used token cleanly", async () => {
    tokenRow = null;
    const res = await POST(
      resetRequest({ token: "unknown-token", password: STRONG_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/invalid or expired/i);
    expect(passwordUpdateCalls).toHaveLength(0);
  });

  it("rejects an expired token and deletes it", async () => {
    tokenRow = validToken({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const res = await POST(
      resetRequest({ token: "expired-token", password: STRONG_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/expired/i);
    expect(deletedTokenIds).toEqual([5]);
    expect(passwordUpdateCalls).toHaveLength(0);
  });

  it("enforces password requirements against the account's real email/name from the token row, not the request body", async () => {
    // The request body doesn't send an email or name at all -- the route
    // must reject a password containing the *account's* email/name, which
    // it can only know by looking up the token's user row.
    tokenRow = validToken({
      email: "priyasharma@example.com",
      name: "Priya Sharma",
    });

    const res = await POST(
      resetRequest({ token: "valid-token", password: "Priyasharma123$$" }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("Password needs");
    expect(passwordUpdateCalls).toHaveLength(0);
  });

  it("rejects a weak (low-entropy) password even with a valid token", async () => {
    tokenRow = validToken();
    const res = await POST(
      resetRequest({ token: "valid-token", password: "aaaaaaaaaaaaaaaa" }),
    );
    expect(res.status).toBe(400);
    expect(passwordUpdateCalls).toHaveLength(0);
  });

  it("resets the password on a valid token, storing a real hash and marking the token used", async () => {
    tokenRow = validToken();

    const res = await POST(
      resetRequest({ token: "valid-reset-token", password: STRONG_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/reset successfully/i);

    expect(passwordUpdateCalls).toHaveLength(1);
    const [storedHash, userId] = passwordUpdateCalls[0];
    expect(userId).toBe(42);
    expect(storedHash).not.toBe(STRONG_PASSWORD);
    expect(await verifyPassword(STRONG_PASSWORD, storedHash as string)).toBe(
      true,
    );

    expect(tokenUsedCalls).toEqual([[5]]);
  }, 15_000);

  it("clears all sessions and trusted devices for the account on success", async () => {
    tokenRow = validToken({ user_id: 77 });

    await POST(
      resetRequest({ token: "valid-reset-token", password: STRONG_PASSWORD }),
    );

    expect(sessionDeleteCalls).toEqual([[77]]);
    expect(deviceTrustDeleteCalls).toEqual([[77]]);
  }, 15_000);

  it("mentions 2FA in the success message when the account has 2FA enabled", async () => {
    tokenRow = validToken({ totp_enabled: true });

    const res = await POST(
      resetRequest({ token: "valid-reset-token", password: STRONG_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/2fa/i);
  }, 15_000);

  it("sends a password-changed notification in the background on success", async () => {
    tokenRow = validToken();

    await POST(
      resetRequest({ token: "valid-reset-token", password: STRONG_PASSWORD }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("never stores the raw incoming token, only its hash", async () => {
    tokenRow = validToken();
    const rawToken = "plaintext-reset-token-value";

    await POST(resetRequest({ token: rawToken, password: STRONG_PASSWORD }));

    const lookup = queries.find(
      (q) =>
        q.sql.includes("FROM password_reset_tokens prt") &&
        q.sql.includes("FOR UPDATE"),
    );
    // AUDIT-002#secrets-03: HMAC digest plus the pre-HMAC one, so a reset
    // link already sent when that shipped still resolves. Both are digests.
    const candidates = lookup?.params[0] as string[];
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates).not.toContain(rawToken);
    for (const candidate of candidates) {
      expect(candidate).toMatch(/^[a-f0-9]{64}$/);
    }
  }, 15_000);
});
