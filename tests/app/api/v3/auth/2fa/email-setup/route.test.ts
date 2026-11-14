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
 *
 * Turning email codes on is two calls: the first mails a confirmation code
 * and changes nothing, the second enters it back and only then flips
 * totp_enabled. It used to flip on the first call, so an address that never
 * gets our mail, or a server with no SMTP at all, locked the account out at
 * its next sign-in.
 */

process.env.API_KEY_ENCRYPTION_KEY = "e".repeat(64);

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

/** email_2fa_codes, in memory. */
let codeRows: {
  id: number;
  user_id: number;
  code_hash: string;
  code_salt: string;
  purpose: string;
}[] = [];
let nextCodeId = 1;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
    if ((rateLimitCounts.get(key) ?? 0) >= (params[2] as number)) {
      return { rows: [] };
    }
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
  if (s.startsWith("SELECT created_at FROM email_2fa_codes"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id")) {
    deleteCodesCalls.push(params);
    // Either one purpose bound as $2, or the literal list the disable path
    // names, or (what it used to send) every purpose.
    const listed = /purpose IN \(([^)]*)\)/.exec(s)?.[1];
    const purposes = listed
      ? listed.split(",").map((p) => p.trim().replace(/'/g, ""))
      : params.length > 1
        ? [params[1] as string]
        : null;
    codeRows = codeRows.filter(
      (r) =>
        r.user_id !== params[0] ||
        (purposes !== null && !purposes.includes(r.purpose)),
    );
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO email_2fa_codes")) {
    codeRows.push({
      id: nextCodeId++,
      user_id: params[0] as number,
      code_hash: params[1] as string,
      code_salt: params[2] as string,
      purpose: params[4] as string,
    });
    return { rows: [] };
  }
  if (s.startsWith("SELECT id, code_salt, code_hash FROM email_2fa_codes")) {
    return {
      rows: codeRows.filter(
        (r) => r.user_id === params[0] && r.purpose === params[1],
      ),
    };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE id = $1 RETURNING id")) {
    const before = codeRows.length;
    codeRows = codeRows.filter((r) => r.id !== params[0]);
    return { rows: codeRows.length < before ? [{ id: params[0] }] : [] };
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

let emailConfigured = true;
const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    isEmailConfigured: () => emailConfigured,
    sendEmail: (params: unknown) => mockSendEmail(params),
  };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { STEP_UP_COOKIE, signStepUpToken } = await import("@/lib/auth/reauth");
const { hashSessionId } = await import("@/lib/auth/auth");
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

function stepUp(userId = 1) {
  cookieState.set(
    STEP_UP_COOKIE,
    signStepUpToken(userId, hashSessionId("session-1")),
  );
}

/** The code the last mail carried. */
function mailedCode(): string {
  const last = mockSendEmail.mock.calls.at(-1)?.[0] as { text: string };
  return /Your code is (\d{6})/.exec(last.text)![1];
}

const passwordUser = () => ({
  password_hash: realPasswordHash,
  totp_enabled: false,
  two_factor_method: null,
  email: "user@example.com",
});

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
  codeRows = [];
  emailConfigured = true;
  invalidateSettingsCache();
});

describe("POST /api/v3/auth/2fa/email-setup", () => {
  it("requires a session", async () => {
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("refuses with 409 when this server cannot send email, before any password is spent", async () => {
    emailConfigured = false;
    login(1);
    userRow = passwordUser();
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/cannot send email/);
    expect(enableUpdateCalls).toHaveLength(0);
    expect(rateLimitCounts.size).toBe(0);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("UPDATE users SET totp_enabled"),
      ),
    ).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("rate limits repeated attempts", async () => {
    login(1);
    rateLimitCounts.set("email-2fa-setup:1:unknown", 5);
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).not.toMatch(/\(s\)/);
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
    userRow = passwordUser();
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

  it("asks an OAuth-only account for the mailed step-up, not its session alone", async () => {
    login(1);
    userRow = { ...passwordUser(), password_hash: null };
    const res = await POST(req("POST", {}));
    expect(res.status).toBe(403);
    expect((await res.json()).stepUp).toBe(true);
    expect(enableUpdateCalls).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("lets an OAuth-only account that stepped up turn email codes on", async () => {
    login(1);
    stepUp(1);
    userRow = {
      ...passwordUser(),
      password_hash: null,
      email: "oauth@example.com",
    };
    const sent = await POST(req("POST", {}));
    expect(sent.status).toBe(200);
    expect(enableUpdateCalls).toHaveLength(0);

    const res = await POST(req("POST", { code: mailedCode() }));
    expect(res.status).toBe(200);
    expect(enableUpdateCalls).toEqual([[1]]);
  });

  it("rejects an incorrect password", async () => {
    login();
    userRow = passwordUser();
    const res = await POST(req("POST", { password: "totally-wrong" }));
    expect(res.status).toBe(403);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("refuses to enable email 2FA when authenticator-app 2FA is already active", async () => {
    login();
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "app",
    };
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("mails a confirmation code on the correct password and changes nothing yet", async () => {
    login(1);
    userRow = passwordUser();
    const res = await POST(req("POST", { password: REAL_PASSWORD }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      codeSent: true,
      maskedEmail: "us***@example.com",
    });
    expect(enableUpdateCalls).toHaveLength(0);
    expect(codeRows).toHaveLength(1);
    expect(codeRows[0].purpose).toBe("setup");
    const mail = mockSendEmail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(mail.to).toBe("user@example.com");
    // Never the code in the subject, and not the sign-in template either.
    expect(mail.subject).not.toMatch(/\d{6}/);
    expect(mail.text).not.toMatch(/try to sign in/);
  });

  it("turns email codes on once the mailed code comes back", async () => {
    login(1);
    userRow = passwordUser();
    await POST(req("POST", { password: REAL_PASSWORD }));
    const code = mailedCode();

    const res = await POST(req("POST", { password: REAL_PASSWORD, code }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(enableUpdateCalls).toEqual([[1]]);
    expect(codeRows).toHaveLength(0);

    await new Promise((resolve) => setImmediate(resolve));
    // The confirmation code, then the "email codes are on" notice.
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("refuses a wrong confirmation code and leaves email codes off", async () => {
    login(1);
    userRow = passwordUser();
    await POST(req("POST", { password: REAL_PASSWORD }));
    const wrong = mailedCode() === "123456" ? "654321" : "123456";

    const res = await POST(
      req("POST", { password: REAL_PASSWORD, code: wrong }),
    );
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("does not accept a sign-in or step-up code as the confirmation", async () => {
    login(1);
    userRow = passwordUser();
    await POST(req("POST", { password: REAL_PASSWORD }));
    const code = mailedCode();
    for (const row of codeRows) row.purpose = "login";

    const res = await POST(req("POST", { password: REAL_PASSWORD, code }));
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("still re-authenticates the confirming call", async () => {
    login(1);
    userRow = passwordUser();
    await POST(req("POST", { password: REAL_PASSWORD }));
    const res = await POST(req("POST", { code: mailedCode() }));
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
  });

  it("answers a code that is not six digits with a 400", async () => {
    login(1);
    userRow = passwordUser();
    const res = await POST(
      req("POST", { password: REAL_PASSWORD, code: "12ab56" }),
    );
    expect(res.status).toBe(400);
    expect(enableUpdateCalls).toHaveLength(0);
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

  it("answers a null body with a 400, not a 500", async () => {
    login();
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "email",
    };
    const res = await DELETE(req("DELETE", null));
    expect(res.status).toBe(400);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("requires a password when the account has one", async () => {
    login();
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "email",
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

  it("asks an OAuth-only account for the step-up before turning email codes off", async () => {
    login(1);
    userRow = {
      password_hash: null,
      totp_enabled: true,
      two_factor_method: "email",
      email: "oauth@example.com",
    };
    const refused = await DELETE(req("DELETE", {}));
    expect(refused.status).toBe(403);
    expect(disableUpdateCalls).toHaveLength(0);

    stepUp(1);
    const res = await DELETE(req("DELETE", {}));
    expect(res.status).toBe(200);
    expect(disableUpdateCalls).toEqual([[1]]);
    expect(deleteCodesCalls).toEqual([[1]]);
  });

  it("rejects an incorrect password", async () => {
    login();
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "email",
    };
    const res = await DELETE(req("DELETE", { password: "totally-wrong" }));
    expect(res.status).toBe(403);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("rejects when email 2FA isn't the active method", async () => {
    login();
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "app",
    };
    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));
    expect(res.status).toBe(400);
    expect(disableUpdateCalls).toHaveLength(0);
  });

  it("disables email 2FA and clears pending codes on the correct password", async () => {
    login(1);
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "email",
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

  // Turning email codes off clears the codes email sign-in issued and a
  // waiting inbox check. It used to clear every purpose, so a step-up code
  // mailed for a change in another tab stopped working under it: the same
  // bug the sign-in paths had until they cleared their own purpose only.
  it("leaves a step-up code in flight when it turns email codes off", async () => {
    login(1);
    userRow = {
      ...passwordUser(),
      totp_enabled: true,
      two_factor_method: "email",
    };
    codeRows = ["login", "setup", "reauth"].map((purpose) => ({
      id: nextCodeId++,
      user_id: 1,
      code_hash: "h",
      code_salt: "s",
      purpose,
    }));

    const res = await DELETE(req("DELETE", { password: REAL_PASSWORD }));

    expect(res.status).toBe(200);
    expect(codeRows.map((r) => r.purpose)).toEqual(["reauth"]);
  });
});
