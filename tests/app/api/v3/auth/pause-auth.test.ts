/**
 * PAUSE_SIGNUPS and PAUSE_LOGINS, enforced at the API rather than in the UI.
 *
 * The signup form hides itself and the login form shows a notice, and neither
 * of those is the pause: both endpoints are reachable with curl. So every
 * assertion here goes through the route handler.
 *
 * The switches are set the way an admin sets them, by returning a
 * system_settings row from the mocked pool, so the registry's own coercion
 * ("true" -> true) and the runtime-config resolver are part of what is being
 * tested. Same mocking boundary as the sibling login suite: the pg pool and
 * outbound email, nothing below that.
 *
 * The case that matters most is the staff exemption. A login pause that
 * catches staff cannot be undone from the product, only from a psql prompt.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeCookieStore, makeHeaderStore } from "./_test-harness";

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

let settingsRows: { key: string; value: string }[] = [];
let userRow: Record<string, unknown> | null = null;
let userInfoRow: Record<string, unknown> | null = null;
let rateLimitCount = 0;
let sessionInsertCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();

  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    rateLimitCount += 1;
    return { rows: [{ count: String(rateLimitCount) }] };
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
  if (s.startsWith("SELECT 1 FROM device_trust")) return { rows: [] };
  if (s.startsWith("INSERT INTO sessions")) {
    sessionInsertCalls.push(params);
    return { rows: [] };
  }
  if (s.includes("FROM notification_preferences WHERE user_id")) {
    return { rows: [] };
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
const { POST: loginPOST } = await import("@/app/api/v3/auth/login/route");
const { POST: signupPOST } = await import("@/app/api/v3/auth/signup/route");

const REAL_PASSWORD = "Correct-Horse-Battery-92!";
let realPasswordHash: string;

beforeAll(async () => {
  realPasswordHash = await hashPassword(REAL_PASSWORD);
}, 20_000);

function jsonPost(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setUser(role: string) {
  userRow = {
    id: 1,
    email: "user@example.com",
    password_hash: realPasswordHash,
    name: "Test User",
    plan: "free",
    role,
    disabled_at: null,
    email_verified_at: new Date().toISOString(),
    totp_enabled: false,
    two_factor_method: null,
    tos_accepted_at: null,
  };
  userInfoRow = {
    totp_enabled: false,
    two_factor_method: "app",
    disabled_at: null,
    email_verified_at: new Date().toISOString(),
    role,
  };
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  mockSendEmail.mockClear();
  settingsRows = [];
  userRow = null;
  userInfoRow = null;
  rateLimitCount = 0;
  sessionInsertCalls = [];
  invalidateSettingsCache();
});

describe("PAUSE_SIGNUPS", () => {
  it("refuses POST /api/v3/auth/signup with 503 and the operator's reason", async () => {
    settingsRows = [
      { key: "PAUSE_SIGNUPS", value: "true" },
      { key: "PAUSE_SIGNUPS_MESSAGE", value: "Invite only until Monday." },
    ];
    const res = await signupPOST(
      jsonPost("/api/v3/auth/signup", {
        email: "new@example.com",
        password: REAL_PASSWORD,
        name: "New Person",
      }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Invite only until Monday.",
      paused: true,
    });
  });

  it("refuses before touching the database, so no account is half-created", async () => {
    settingsRows = [{ key: "PAUSE_SIGNUPS", value: "true" }];
    await signupPOST(
      jsonPost("/api/v3/auth/signup", {
        email: "new@example.com",
        password: REAL_PASSWORD,
        name: "New Person",
      }),
    );
    const wrote = mockQuery.mock.calls.some(([sql]) =>
      String(sql).trim().toUpperCase().startsWith("INSERT INTO USERS"),
    );
    expect(wrote).toBe(false);
  });

  it("is also refused when only MAINTENANCE_MODE is on", async () => {
    settingsRows = [{ key: "MAINTENANCE_MODE", value: "true" }];
    const res = await signupPOST(
      jsonPost("/api/v3/auth/signup", {
        email: "new@example.com",
        password: REAL_PASSWORD,
        name: "New Person",
      }),
    );
    expect(res.status).toBe(503);
  });

  // Control: without this, the assertions above would pass just as happily
  // with a gate that refuses unconditionally.
  it("lets a signup through to normal validation when the switch is off", async () => {
    const res = await signupPOST(
      jsonPost("/api/v3/auth/signup", { email: "not-an-email" }),
    );
    expect(res.status).not.toBe(503);
  });
});

describe("PAUSE_LOGINS", () => {
  it("refuses a non-staff account that supplied the correct password", async () => {
    settingsRows = [
      { key: "PAUSE_LOGINS", value: "true" },
      { key: "PAUSE_LOGINS_MESSAGE", value: "Back at 09:00 UTC." },
    ];
    setUser("user");
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "user@example.com",
        password: REAL_PASSWORD,
      }),
    );
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Back at 09:00 UTC.",
    });
    // The refusal has to happen before the session row, or the pause did
    // nothing except add a confusing message to a successful login.
    expect(sessionInsertCalls).toHaveLength(0);
  });

  // The property the whole switch hinges on.
  it.each(["support", "moderator", "admin", "super_admin"])(
    "still signs in a %s account",
    async (role) => {
      settingsRows = [{ key: "PAUSE_LOGINS", value: "true" }];
      setUser(role);
      const res = await loginPOST(
        jsonPost("/api/v3/auth/login", {
          email: "user@example.com",
          password: REAL_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);
      expect(sessionInsertCalls).toHaveLength(1);
    },
  );

  it("still signs staff in during full maintenance", async () => {
    settingsRows = [{ key: "MAINTENANCE_MODE", value: "true" }];
    setUser("admin");
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "user@example.com",
        password: REAL_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(sessionInsertCalls).toHaveLength(1);
  });

  it("blocks a non-staff login during full maintenance", async () => {
    settingsRows = [{ key: "MAINTENANCE_MODE", value: "true" }];
    setUser("user");
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "user@example.com",
        password: REAL_PASSWORD,
      }),
    );
    expect(res.status).toBe(503);
    expect(sessionInsertCalls).toHaveLength(0);
  });

  // The pause is checked after the password is verified precisely so it
  // cannot be used to sort real accounts (and staff accounts) from the rest.
  it("answers a wrong password with the usual 401, not the pause notice", async () => {
    settingsRows = [{ key: "PAUSE_LOGINS", value: "true" }];
    setUser("user");
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "user@example.com",
        password: "not-the-password",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("answers an unknown address with the usual 401, not the pause notice", async () => {
    settingsRows = [{ key: "PAUSE_LOGINS", value: "true" }];
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "nobody@example.com",
        password: REAL_PASSWORD,
      }),
    );
    expect(res.status).toBe(401);
  });

  it("lets a normal login through when the switch is off", async () => {
    setUser("user");
    const res = await loginPOST(
      jsonPost("/api/v3/auth/login", {
        email: "user@example.com",
        password: REAL_PASSWORD,
      }),
    );
    expect(res.status).toBe(200);
    expect(sessionInsertCalls).toHaveLength(1);
  });
});
