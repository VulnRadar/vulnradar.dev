import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for POST and DELETE /api/v3/auth/2fa/email-setup.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email. getSession and verifyPassword run for real. POST (enable) and
 * DELETE (disable) share the exact same rate-limit bucket key
 * ("email-2fa-setup:<userId>:<ip>"), which is exercised explicitly below.
 */

const rateLimitCounts = new Map<string, number>();
let sessionRow: Record<string, unknown> | null = null;
let userRow: {
  password_hash: string | null;
  totp_enabled: boolean;
  two_factor_method: string | null;
  email: string;
} | null = null;
let enableUpdateCalls: unknown[][] = [];
let disableUpdateCalls: unknown[][] = [];
let deleteCodesCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    const next = (rateLimitCounts.get(key) ?? 0) + 1;
    rateLimitCounts.set(key, next);
    return { rows: [{ count: String(next) }] };
  }
  // The re-auth helper (lib/auth/reauth.ts) runs its own password_hash
  // read, so the route's own SELECT no longer carries the hash.
  if (s.startsWith("SELECT password_hash FROM users")) {
    return {
      rows: userRow ? [{ password_hash: userRow.password_hash }] : [],
    };
  }
  if (
    s.startsWith("SELECT totp_enabled, two_factor_method, email FROM users") ||
    s.startsWith("SELECT two_factor_method, email FROM users")
  ) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (
    s.startsWith(
      "UPDATE users SET totp_enabled = true, two_factor_method = 'email'",
    )
  ) {
    enableUpdateCalls.push(params);
    return { rows: [] };
  }
  if (
    s.startsWith(
      "UPDATE users SET totp_enabled = false, two_factor_method = NULL",
    )
  ) {
    disableUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id")) {
    deleteCodesCalls.push(params);
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
  },
}));

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore, state: headerState } = makeHeaderStore();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return { ...actual, sendEmail: (params: unknown) => mockSendEmail(params) };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { POST, DELETE } =
  await import("@/app/api/v3/auth/2fa/email-setup/route");

const REAL_PASSWORD = "Mp5$Vqtnrlwz73";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function req(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/email-setup", {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function login(userId = 1) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow({ user_id: userId });
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  rateLimitCounts.clear();
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  sessionRow = null;
  userRow = null;
  enableUpdateCalls = [];
  disableUpdateCalls = [];
  deleteCodesCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/2fa/email-setup", () => {
  it("requires a session", async () => {
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("rate limits repeated attempts", async () => {
    login(1);
    rateLimitCounts.set("email-2fa-setup:1:unknown", 5);
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(429);
  });

  it("rejects a malformed JSON body", async () => {
    login();
    const res = await POST(
      new NextRequest("http://localhost/api/v3/auth/2fa/email-setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("requires a password when the account has one", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: false,
      two_factor_method: null,
      email: "user@example.com",
    };
    const res = await POST(req("POST", {}));
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("rejects a stale session whose user row is gone", async () => {
    login();
    userRow = null;
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    // The re-auth helper fails closed on a missing row rather than
    // distinguishing "deleted account" from "wrong password".
    expect(res.status).toBe(403);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("lets an OAuth-only account (no password) enable email 2FA", async () => {
    login(1);
    userRow = {
      password_hash: null,
      totp_enabled: false,
      two_factor_method: null,
      email: "oauth@example.com",
    };
    const res = await POST(req("POST", {}));
    expect(res.status).toBe(200);
    expect(enableUpdateCalls).toEqual([[1]]);
  });

  it("rejects an incorrect password", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: false,
      two_factor_method: null,
      email: "user@example.com",
    };
    const res = await POST(req("POST", { password: "totally-wrong" }));
    expect(res.status).toBe(403);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("refuses to enable email 2FA when authenticator-app 2FA is already active", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      two_factor_method: "app",
      email: "user@example.com",
    };
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("enables email 2FA on the correct password", async () => {
    login(1);
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: false,
      two_factor_method: null,
      email: "user@example.com",
    };
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(enableUpdateCalls).toEqual([[1]]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/v3/auth/2fa/email-setup", () => {
  it("requires a session", async () => {
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("shares its rate-limit bucket with POST, so exhausting it via POST also blocks DELETE", async () => {
    login(1);
    rateLimitCounts.set("email-2fa-setup:1:unknown", 5); // simulate POST having exhausted the shared bucket
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    expect(res.status).toBe(429);
  });

  it("requires a password when the account has one", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      two_factor_method: "email",
      email: "user@example.com",
    };
    const res = await DELETE(req("DELETE", {}));
    expect(res.status).toBe(400);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("rejects a stale session whose user row is gone", async () => {
    login();
    userRow = null;
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    expect(res.status).toBe(403);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("lets an OAuth-only account (no password) disable email 2FA", async () => {
    login(1);
    userRow = {
      password_hash: null,
      totp_enabled: true,
      two_factor_method: "email",
      email: "oauth@example.com",
    };
    const res = await DELETE(req("DELETE", {}));
    expect(res.status).toBe(200);
    expect(disableUpdateCalls).toEqual([[1]]);
    expect(deleteCodesCalls).toEqual([[1]]);
  });

  it("rejects an incorrect password", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      two_factor_method: "email",
      email: "user@example.com",
    };
    const res = await DELETE(req("DELETE", { password: "totally-wrong" }));
    expect(res.status).toBe(403);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("rejects when email 2FA isn't the active method", async () => {
    login();
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      two_factor_method: "app",
      email: "user@example.com",
    };
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("disables email 2FA and clears pending codes on the correct password", async () => {
    login(1);
    userRow = {
      password_hash: realPasswordHash,
      totp_enabled: true,
      two_factor_method: "email",
      email: "user@example.com",
    };
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(disableUpdateCalls).toEqual([[1]]);
    expect(deleteCodesCalls).toEqual([[1]]);

    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });
});
