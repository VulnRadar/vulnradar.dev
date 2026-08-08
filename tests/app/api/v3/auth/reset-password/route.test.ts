import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeHeaderStore } from "../_test-harness";

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

let tokenRow: {
  id: number;
  user_id: number;
  expires_at: string;
  email: string;
  name: string | null;
  totp_enabled: boolean;
} | null = null;

let deletedTokenIds: number[] = [];
let passwordUpdateCalls: unknown[][] = [];
let tokenUsedCalls: unknown[][] = [];
let sessionDeleteCalls: unknown[][] = [];
let deviceTrustDeleteCalls: unknown[][] = [];

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
  if (s.includes("FROM notification_preferences WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("SELECT unsubscribe_token FROM users WHERE id")) {
    return { rows: [{ unsubscribe_token: null }] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
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
  headerState.clear();
  tokenRow = null;
  deletedTokenIds = [];
  passwordUpdateCalls = [];
  tokenUsedCalls = [];
  sessionDeleteCalls = [];
  deviceTrustDeleteCalls = [];
});

describe("POST /api/v3/auth/reset-password", () => {
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
    expect(lookup?.params[0]).not.toBe(rawToken);
    expect(lookup?.params[0]).toMatch(/^[a-f0-9]{64}$/);
  }, 15_000);
});
