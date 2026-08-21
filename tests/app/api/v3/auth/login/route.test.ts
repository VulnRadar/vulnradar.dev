import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Route-level tests for POST /api/v3/auth/login.
 *
 * Mocked at the network/database boundary only (see tests/README.md):
 * the pg pool and outbound email sends (lib/email/email's sendEmail).
 * getUserByEmail, verifyPassword, hashPassword, createSession,
 * checkRateLimit, and findTrustedDevice all run for real against the
 * mocked pool and a fake next/headers cookie/header store, so a broken
 * scrypt call or a broken rate-limit bucket calculation would fail this
 * suite the way it failed to catch the real signup outage this repo's
 * test docs describe.
 */

import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";
void defaultSessionRow; // not needed here, kept for parity with sibling suites

// The 2FA-challenge branch signs a pending token (lib/auth/pending-2fa), which
// requires a 32-byte hex key. Set before the route runs, matching sibling suites.
process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];

let userRow: Record<string, unknown> | null = null;
let userInfoRow: Record<string, unknown> | null = null;
let trustedDeviceRow: Record<string, unknown> | null = null;
let rateLimitCount = 0;
let sessionInsertCalls: unknown[][] = [];
let email2FAInsertCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    rateLimitCount += 1;
    return { rows: [{ count: String(rateLimitCount) }] };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  if (s.includes("WHERE email = $1") && s.includes("password_hash")) {
    return { rows: userRow ? [userRow] : [] };
  }
  if (
    s.includes(
      "totp_enabled, two_factor_method, disabled_at, email_verified_at",
    )
  ) {
    return { rows: userInfoRow ? [userInfoRow] : [] };
  }
  if (s.startsWith("SELECT 1 FROM device_trust")) {
    return { rows: trustedDeviceRow ? [trustedDeviceRow] : [] };
  }
  if (s.startsWith("UPDATE device_trust SET last_used_at")) return { rows: [] };
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("INSERT INTO email_2fa_codes")) {
    email2FAInsertCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO sessions")) {
    sessionInsertCalls.push(params);
    return { rows: [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id")) {
    return { rows: [] }; // no row -> default preferences (all enabled)
  }
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
const {
  AUTH_2FA_PENDING_COOKIE,
  DEVICE_TRUST_COOKIE_NAME,
  AUTH_SESSION_COOKIE_NAME,
} = await import("@/lib/config/constants");
const { POST } = await import("@/app/api/v3/auth/login/route");

const REAL_PASSWORD = "Correct-Horse-Battery-92!";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function postLogin(body: unknown, cookies?: Record<string, string>) {
  return new NextRequest("http://localhost/api/v3/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookies
        ? {
            cookie: Object.entries(cookies)
              .map(([k, v]) => `${k}=${v}`)
              .join("; "),
          }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "user@example.com",
    password_hash: realPasswordHash,
    name: "Test User",
    plan: "free",
    role: "user",
    disabled_at: null,
    email_verified_at: new Date().toISOString(),
    totp_secret: null,
    totp_enabled: false,
    two_factor_method: null,
    tos_accepted_at: null,
    ...overrides,
  };
}

function baseUserInfo(overrides: Record<string, unknown> = {}) {
  return {
    totp_enabled: false,
    two_factor_method: "app",
    disabled_at: null,
    email_verified_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  // Drain any background setImmediate email sends left pending by the
  // previous test before resetting mocks, so a leftover callback can't
  // fire mid-test and inflate a call count assertion.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  mockSendEmail.mockClear();
  userRow = null;
  userInfoRow = null;
  trustedDeviceRow = null;
  rateLimitCount = 0;
  sessionInsertCalls = [];
  email2FAInsertCalls = [];
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/login", () => {
  it("rejects a missing email", async () => {
    const res = await POST(postLogin({ password: "whatever" }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await POST(postLogin({ email: "not-an-email", password: "x" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing password", async () => {
    const res = await POST(postLogin({ email: "user@example.com" }));
    expect(res.status).toBe(400);
  });

  it("succeeds with correct credentials and no 2FA, creating a real session", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({ totp_enabled: false });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user).toEqual({
      id: 1,
      email: "user@example.com",
      name: "Test User",
    });
    expect(sessionInsertCalls).toHaveLength(1);
    expect(sessionInsertCalls[0][1]).toBe(1); // user_id
    // Real createSession() sets the session cookie via next/headers cookies().
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBeTruthy();
  });

  it("fails with the wrong password without revealing whether the account exists", async () => {
    userRow = baseUser();

    const res = await POST(
      postLogin({
        email: "user@example.com",
        password: "totally-wrong-password",
      }),
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    const unknownEmailRes = await POST(
      postLogin({
        email: "nobody@example.com",
        password: "totally-wrong-password",
      }),
    );
    const unknownJson = await unknownEmailRes.json();

    expect(unknownEmailRes.status).toBe(401);
    // Same status and same error message for "wrong password" and "no such
    // account" -- the response gives an attacker no signal either way.
    expect(unknownJson.error).toBe(json.error);
    expect(sessionInsertCalls).toHaveLength(0);
    // Two real logins, each running scrypt (N=2^17) plus the timing-
    // equalization dummy hash -- generous timeout so it doesn't flake under a
    // loaded parallel full-suite run.
  }, 20_000);

  it("still runs a scrypt comparison for an unknown email (timing equalization)", async () => {
    userRow = null;
    const res = await POST(
      postLogin({ email: "nobody@example.com", password: "whatever12345" }),
    );
    expect(res.status).toBe(401);
    // getUserByEmail was queried, and no session/2FA-code inserts happened.
    expect(
      queries.some(
        (q) =>
          q.sql.includes("WHERE email = $1") && q.sql.includes("password_hash"),
      ),
    ).toBe(true);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  it("rejects a disabled account", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({ disabled_at: new Date().toISOString() });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );

    expect(res.status).toBe(403);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  it("rejects an unverified account", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({ email_verified_at: null });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(sessionInsertCalls).toHaveLength(0);
    // ApiResponse.forbidden(message, meta) now spreads meta into the JSON
    // body, so the client can distinguish "unverified" from any other 403.
    expect(json.unverified).toBe(true);
    expect(json.error).toBeTruthy();
  });

  it("rate limits repeated login attempts from the same IP", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo();
    rateLimitCount = 5; // next INSERT ... RETURNING count comes back as 6 > maxAttempts(5)

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );

    expect(res.status).toBe(429);
    expect(sessionInsertCalls).toHaveLength(0);
    // getUserByEmail must not even run once the bucket is exhausted.
    expect(
      queries.some(
        (q) =>
          q.sql.includes("WHERE email = $1") && q.sql.includes("password_hash"),
      ),
    ).toBe(false);
  });

  it("routes a 2FA-enabled account to the 2FA challenge instead of a full session", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({
      totp_enabled: true,
      two_factor_method: "app",
    });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requires2FA).toBe(true);
    expect(json.userId).toBe(1);
    expect(json.twoFactorMethod).toBe("app");
    expect(sessionInsertCalls).toHaveLength(0);
    // The pending-2FA cookie is set, not the real session cookie.
    expect(cookieState.get(AUTH_SESSION_COOKIE_NAME)).toBeUndefined();
    const setCookieHeader = res.headers.get("set-cookie") || "";
    expect(setCookieHeader).toContain(AUTH_2FA_PENDING_COOKIE);
  });

  it("emails a 2FA code and masks the email for email-method 2FA", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({
      totp_enabled: true,
      two_factor_method: "email",
    });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requires2FA).toBe(true);
    expect(json.twoFactorMethod).toBe("email");
    expect(json.maskedEmail).toBe("us***@example.com");
    expect(email2FAInsertCalls).toHaveLength(1);
    // Email send is queued via setImmediate; flush the macrotask queue.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("skips 2FA for a trusted device and creates a session directly", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({
      totp_enabled: true,
      two_factor_method: "app",
    });
    trustedDeviceRow = { "?column?": 1 };
    const deviceToken = "a".repeat(64);

    const res = await POST(
      postLogin(
        { email: "user@example.com", password: REAL_PASSWORD },
        { [DEVICE_TRUST_COOKIE_NAME]: deviceToken },
      ),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requires2FA).toBeUndefined();
    expect(json.user.email).toBe("user@example.com");
    expect(sessionInsertCalls).toHaveLength(1);
  });
});
