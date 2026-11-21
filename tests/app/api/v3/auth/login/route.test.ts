import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createHash, createHmac, randomBytes, scryptSync } from "node:crypto";

/**
 * The per-account lockout key.
 *
 * Keyed on a hash of the submitted address rather than on users.id, because
 * only a real account could ever have a counter under an id: the "Too many
 * failed attempts for this account" message was therefore proof the address
 * exists, which made it an enumeration oracle on a surface that is otherwise
 * scrupulously non-enumerating.
 */
const accountKey = (email: string) =>
  `login-fail:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

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
// The emailed-code digest is keyed with AUTH_SECRET first; unset here so it
// is the key above.
delete process.env.AUTH_SECRET;

const queries: { sql: string; params: unknown[] }[] = [];

let userRow: Record<string, unknown> | null = null;
let userInfoRow: Record<string, unknown> | null = null;
let trustedDeviceRow: Record<string, unknown> | null = null;
let rateLimitCount = 0;
let sessionInsertCalls: unknown[][] = [];
let email2FAInsertCalls: unknown[][] = [];
let settingsRows: { key: string; value: string }[] = [];
// When set, the users-by-email lookup rejects, as it does while the database
// is down or failing over.
let usersLookupError: Error | null = null;
// When set, the login-fail:<hash> buckets are counted per key, the way
// Postgres counts them, and every other limiter always allows. The shared
// rateLimitCount above cannot tell two buckets apart, which is exactly what
// the uniform-lockout tests need to see.
let keyedFailCounts: Map<string, number> | null = null;
// When set, the opportunistic rehash UPDATE rejects.
let rehashError: Error | null = null;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (
    usersLookupError &&
    s.includes("WHERE LOWER(email) = $1") &&
    s.includes("password_hash")
  ) {
    throw usersLookupError;
  }

  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (keyedFailCounts && s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    if (!key.startsWith("login-fail:")) return { rows: [{ count: "2" }] };
    const current = keyedFailCounts.get(key) ?? 0;
    if (current >= (params[2] as number)) return { rows: [] };
    keyedFailCounts.set(key, current + 1);
    return { rows: [{ count: String(current + 1) }] };
  }
  if (keyedFailCounts && s.startsWith('SELECT "count" FROM rate_limits')) {
    const count = keyedFailCounts.get(params[0] as string);
    return { rows: count === undefined ? [] : [{ count: String(count) }] };
  }
  if (s.startsWith("UPDATE users SET password_hash")) {
    if (rehashError) throw rehashError;
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith("INSERT INTO rate_limits")) {
    if (rateLimitCount >= (params[2] as number)) return { rows: [] };
    rateLimitCount += 1;
    return { rows: [{ count: String(rateLimitCount) }] };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  if (s.includes("WHERE LOWER(email) = $1") && s.includes("password_hash")) {
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
  usersLookupError = null;
  keyedFailCounts = null;
  rehashError = null;
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

  // Validate.email is the rule for a NEW address. Sign-in looks up one that
  // already exists, stored under the old one-@ rule, and a self-hosted first
  // account is often admin@localhost: refusing it here would lock its owner
  // out of an account nothing is wrong with.
  it("signs in an account whose stored address predates the new-address rule", async () => {
    userRow = baseUser({ email: "admin@localhost" });
    userInfoRow = baseUserInfo({ totp_enabled: false });

    const res = await POST(
      postLogin({ email: "admin@localhost", password: REAL_PASSWORD }),
    );

    expect(res.status).toBe(200);
    expect(sessionInsertCalls).toHaveLength(1);
  });

  it("forgives the account's failed-login counter once the password is proved", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({ totp_enabled: false });

    await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );

    // resetRateLimit issues an unconditional single-parameter DELETE; the
    // housekeeping delete inside checkRateLimit takes two (key + cutoff).
    const resets = queries.filter(
      (q) =>
        q.sql.startsWith("DELETE FROM rate_limits WHERE key = $1") &&
        q.params.length === 1,
    );
    expect(resets.map((q) => q.params[0])).toContain(
      accountKey("user@example.com"),
    );
    // The per-IP bucket is deliberately NOT cleared: it throttles the source
    // address, so a valid login must not reset one address's own quota.
    expect(resets.map((q) => q.params[0])).not.toContain("login:unknown");
  });

  it("gives the per-account lockout its own, larger window than the per-IP gate", async () => {
    userRow = baseUser();
    userInfoRow = baseUserInfo({ totp_enabled: false });

    await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );

    // Bucket boundaries are quantized to the window, so the window each gate
    // uses is readable straight off the peek/upsert parameters. Sharing one
    // bucket size was the bug: an attacker IP's whole per-IP allowance was
    // exactly enough to fill the account bucket and lock the owner out.
    const accountPeek = queries.find(
      (q) =>
        q.sql.startsWith('SELECT "count" FROM rate_limits') &&
        q.params[0] === accountKey("user@example.com"),
    );
    expect(accountPeek).toBeDefined();
    const accountBucket = (accountPeek!.params[1] as Date).getTime();
    const FIFTEEN_MIN = 15 * 60 * 1000;
    // The per-IP gate uses the 15-minute login window; the account gate uses
    // four of them, so its boundary lands on an hour.
    expect(accountBucket % (4 * FIFTEEN_MIN)).toBe(0);
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
          q.sql.includes("WHERE LOWER(email) = $1") &&
          q.sql.includes("password_hash"),
      ),
    ).toBe(true);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  it("answers 500, not 'invalid credentials', when the user lookup itself fails", async () => {
    // getUserByEmail used to swallow the error and return null, which this
    // route read as "no such account": every valid user was told their
    // password was wrong for as long as the database was failing, a monitor saw
    // 401s instead of 5xx, and each attempt still paid for a dummy scrypt.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    usersLookupError = new Error("connection terminated unexpectedly");
    userRow = baseUser();
    userInfoRow = baseUserInfo({ totp_enabled: false });

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );

    expect(res.status).toBe(500);
    expect(sessionInsertCalls).toHaveLength(0);
    // Nobody checked a password, so no failed-login counter moved. The
    // address's bucket is read before the lookup (the read is what makes the
    // lock answer the same for every address), but nothing is written to it.
    expect(
      queries.some(
        (q) =>
          q.sql.startsWith("INSERT INTO rate_limits") &&
          q.params.includes(accountKey("user@example.com")),
      ),
    ).toBe(false);
    // The failure is on record, not silent.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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
          q.sql.includes("WHERE LOWER(email) = $1") &&
          q.sql.includes("password_hash"),
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
    // Stored for the login purpose by the one issuer (lib/auth/email-codes.ts),
    // not left to the column default by a hand-rolled INSERT.
    expect(email2FAInsertCalls[0]![4]).toBe("login");
    // Only earlier sign-in codes are cleared: a step-up or setup code mailed
    // to the same account a moment ago has to survive a sign-in elsewhere.
    const cleared = mockQuery.mock.calls
      .filter(([sql]) => String(sql).startsWith("DELETE FROM email_2fa_codes"))
      .map(([sql, params]) => [String(sql), params]);
    expect(cleared).toEqual([
      [
        "DELETE FROM email_2fa_codes WHERE user_id = $1 AND purpose = $2",
        [expect.any(Number), "login"],
      ],
    ]);
    // Email send is queued via setImmediate; flush the macrotask queue.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockSendEmail).toHaveBeenCalledTimes(1);

    // enc-13: stored as HMAC-SHA256 of "<salt>:<code>" under the server key,
    // so the row and its salt do not give the mailed code back.
    const [, codeHash, codeSalt] = email2FAInsertCalls[0]! as string[];
    const mailed = mockSendEmail.mock.calls[0]![0] as { text: string };
    const code = /sign-in code is (\d{6})/.exec(mailed.text)![1];
    expect(codeHash).toBe(
      createHmac("sha256", "c".repeat(64))
        .update(`${codeSalt}:${code}`)
        .digest("hex"),
    );
    expect(codeHash).not.toBe(
      createHash("sha256").update(`${codeSalt}:${code}`).digest("hex"),
    );
  });

  it("tells the user the lifetime the emailed code was stored with", async () => {
    settingsRows = [{ key: "EMAIL_2FA_CODE_EXPIRY_MINUTES", value: "3" }];
    invalidateSettingsCache();
    userRow = baseUser();
    userInfoRow = baseUserInfo({
      totp_enabled: true,
      two_factor_method: "email",
    });

    await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    settingsRows = [];
    invalidateSettingsCache();
    expect(email2FAInsertCalls[0][3]).toBe(3);
    expect((mockSendEmail.mock.calls[0][0] as { text: string }).text).toContain(
      "It expires in 3 minutes.",
    );
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

  it("words the per-IP refusal without a '(s)' plural", async () => {
    userRow = baseUser();
    rateLimitCount = 5;

    const res = await POST(
      postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
    );
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(json.error).toMatch(/^Too many login attempts\. Try again in /);
    expect(json.error).not.toContain("(s)");
  });

  it("clears the OAuth and Discord pending sign-ins when it starts a password one", async () => {
    // With two pending cookies the 2FA verify and email-send routes could
    // resolve different accounts, so the code was mailed to one and checked
    // against the other. Starting a password sign-in ends the other two.
    userRow = baseUser();
    userInfoRow = baseUserInfo({
      totp_enabled: true,
      two_factor_method: "app",
    });

    const res = await POST(
      postLogin(
        { email: "user@example.com", password: REAL_PASSWORD },
        { oauth_pending_login: "stale-oauth", discord_pending_login: "stale" },
      ),
    );

    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    const expired = (name: string) =>
      setCookies.find(
        (c) =>
          c.startsWith(`${name}=;`) &&
          c.includes("Expires=Thu, 01 Jan 1970 00:00:00 GMT"),
      );
    expect(expired("oauth_pending_login")).toBeDefined();
    expect(expired("discord_pending_login")).toBeDefined();
    expect(
      setCookies.find((c) => c.startsWith(`${AUTH_2FA_PENDING_COOKIE}=`)),
    ).toMatch(/Max-Age=[1-9]/);
  });

  describe("the per-address lock answers the same for every address", () => {
    // The account bucket is the per-IP login cap times five, over four of
    // its windows: 25 failures an hour at the shipped 5 per 15 minutes.
    const ACCOUNT_CAP = 25;

    beforeEach(() => {
      keyedFailCounts = new Map();
      // One fixed clock, so the two refusals compared below are computed
      // from the same instant and their retry times cannot differ by a tick.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-11-11T10:20:00.000Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // The bucket starts with all but one of its failures in it: the attempts
    // before those are the same request repeated and would only add scrypt
    // time. The last wrong password fills it, and the next attempt is the
    // refusal.
    // Every response carries its own requestId; the rest has to match.
    async function refusal(res: Response) {
      const { requestId, ...body } = await res.json();
      expect(typeof requestId).toBe("string");
      return body;
    }

    async function failUntilLocked(email: string, password: string) {
      keyedFailCounts!.set(accountKey(email), ACCOUNT_CAP - 1);
      const last = await POST(postLogin({ email, password: "wrong-pass-1" }));
      expect(last.status).toBe(401);
      expect(keyedFailCounts!.get(accountKey(email))).toBe(ACCOUNT_CAP);
      return POST(postLogin({ email, password }));
    }

    it("counts failures for an address with no account in the same hashed bucket", async () => {
      userRow = null;

      const first = await POST(
        postLogin({ email: "Nobody@Example.com", password: "wrong-pass-1" }),
      );

      expect(first.status).toBe(401);
      expect(keyedFailCounts!.get(accountKey("nobody@example.com"))).toBe(1);
      // Hashed, so the rate-limit table never holds the address itself.
      expect(
        queries
          .filter((q) => q.sql.includes("rate_limits"))
          .some((q) =>
            q.params.some(
              (p) => typeof p === "string" && p.includes("nobody@"),
            ),
          ),
      ).toBe(false);
    });

    it("refuses an unknown address with the same 429 an existing account gets", async () => {
      userRow = null;
      const unknown = await failUntilLocked(
        "nobody@example.com",
        "wrong-pass-2",
      );
      const unknownBody = await refusal(unknown);

      userRow = baseUser();
      userInfoRow = baseUserInfo({ totp_enabled: false });
      const known = await failUntilLocked("user@example.com", REAL_PASSWORD);
      const knownBody = await refusal(known);

      expect(unknown.status).toBe(429);
      expect(known.status).toBe(429);
      expect(unknownBody).toEqual(knownBody);
      expect(unknown.headers.get("retry-after")).toBe(
        known.headers.get("retry-after"),
      );
      // Locked even with the right password, and no session was made.
      expect(sessionInsertCalls).toHaveLength(0);
      // Nothing in the refusal says an account exists.
      expect(knownBody.error).not.toMatch(/account/i);
      expect(knownBody.error).not.toContain("(s)");
    }, 30_000);

    it("refuses an OAuth-only account with the same 429 too", async () => {
      userRow = null;
      const unknown = await failUntilLocked(
        "nobody@example.com",
        "wrong-pass-2",
      );

      userRow = baseUser({ email: "social@example.com", password_hash: null });
      const oauthOnly = await failUntilLocked(
        "social@example.com",
        "wrong-pass-2",
      );

      expect(oauthOnly.status).toBe(429);
      expect(await refusal(oauthOnly)).toEqual(await refusal(unknown));
    }, 30_000);

    it("refuses a locked address without counting the attempt again", async () => {
      userRow = baseUser();
      keyedFailCounts!.set(accountKey("user@example.com"), ACCOUNT_CAP);

      const res = await POST(
        postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
      );

      expect(res.status).toBe(429);
      expect(keyedFailCounts!.get(accountKey("user@example.com"))).toBe(
        ACCOUNT_CAP,
      );
      expect(
        queries.some(
          (q) =>
            q.sql.startsWith("INSERT INTO rate_limits") &&
            q.params[0] === accountKey("user@example.com"),
        ),
      ).toBe(false);
    });
  });

  describe("upgrading an old password hash", () => {
    // What hashPassword wrote before 2.3.0: "salt:hash", scrypt at Node's
    // defaults (N=16384), about an eighth of today's cost.
    function legacyHash(password: string): string {
      const salt = randomBytes(16).toString("hex");
      return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    }

    it("rewrites a legacy hash at the current cost after a correct password", async () => {
      const oldHash = legacyHash(REAL_PASSWORD);
      userRow = baseUser({ password_hash: oldHash });
      userInfoRow = baseUserInfo({ totp_enabled: false });

      const res = await POST(
        postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
      );

      expect(res.status).toBe(200);
      const update = queries.find((q) =>
        q.sql.startsWith("UPDATE users SET password_hash"),
      );
      expect(update).toBeDefined();
      const [newHash, userId, replaced] = update!.params as [
        string,
        number,
        string,
      ];
      expect(newHash.split(":")).toHaveLength(5);
      expect(newHash.startsWith(`${1 << 17}:8:1:`)).toBe(true);
      expect(userId).toBe(1);
      // Guarded on the hash it replaces, so a password change that lands in
      // between is never overwritten with the old password.
      expect(replaced).toBe(oldHash);
      const { verifyPassword } = await import("@/lib/auth/password-hash");
      expect(await verifyPassword(REAL_PASSWORD, newHash)).toBe(true);
    }, 30_000);

    it("still signs in when the rewrite fails", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      rehashError = new Error("deadlock detected");
      userRow = baseUser({ password_hash: legacyHash(REAL_PASSWORD) });
      userInfoRow = baseUserInfo({ totp_enabled: false });

      const res = await POST(
        postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
      );

      expect(res.status).toBe(200);
      expect(sessionInsertCalls).toHaveLength(1);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    }, 30_000);

    it("leaves a current hash alone", async () => {
      userRow = baseUser();
      userInfoRow = baseUserInfo({ totp_enabled: false });

      await POST(
        postLogin({ email: "user@example.com", password: REAL_PASSWORD }),
      );

      expect(
        queries.some((q) => q.sql.startsWith("UPDATE users SET password_hash")),
      ).toBe(false);
    });

    it("never rewrites on a wrong password", async () => {
      userRow = baseUser({ password_hash: legacyHash(REAL_PASSWORD) });

      const res = await POST(
        postLogin({ email: "user@example.com", password: "wrong-pass-1" }),
      );

      expect(res.status).toBe(401);
      expect(
        queries.some((q) => q.sql.startsWith("UPDATE users SET password_hash")),
      ).toBe(false);
    });
  });
});
