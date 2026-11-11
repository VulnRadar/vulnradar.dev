import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  defaultSessionRow,
  makeCookieStore,
  makeHeaderStore,
} from "../../_test-harness";

/**
 * Route-level tests for POST /api/v3/auth/2fa/email-send.
 *
 * Two jobs. With no body it mails the sign-in code, and is not session-gated:
 * it relies on the pending-2FA cookies set by login and the OAuth and Discord
 * callbacks, read off the request (not next/headers). With
 * { purpose: "reauth" } it mails the step-up code a signed-in password-less
 * account enters before a security change, and needs that session.
 *
 * Mocked at the network/database boundary only: the pg pool and outbound
 * email (sendEmail is awaited directly by this route, not backgrounded).
 */

let userEmailRow: { email: string } | null = null;
let recentCodeRow: { created_at: string } | null = null;
let sessionRow: Record<string, unknown> | null = null;
let deleteCodeCalls: unknown[][] = [];
let insertCodeCalls: unknown[][] = [];
let cooldownCalls: unknown[][] = [];
let settingsRows: { key: string; value: string }[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  if (s.startsWith("DELETE FROM sessions WHERE expires_at")) {
    return { rows: [] };
  }
  if (s.includes("SELECT s.user_id")) {
    return { rows: sessionRow ? [sessionRow] : [] };
  }
  if (s.startsWith("SELECT email FROM users WHERE id = $1")) {
    return { rows: userEmailRow ? [userEmailRow] : [] };
  }
  if (s.startsWith("SELECT created_at FROM email_2fa_codes")) {
    cooldownCalls.push(params);
    return { rows: recentCodeRow ? [recentCodeRow] : [] };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id")) {
    deleteCodeCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO email_2fa_codes")) {
    insertCodeCalls.push(params);
    return { rows: [] };
  }
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { store: headerStore } = makeHeaderStore();
const { store: cookieStore, state: cookieState } = makeCookieStore();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => headerStore),
  cookies: vi.fn(async () => cookieStore),
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

const { AUTH_2FA_PENDING_COOKIE, AUTH_SESSION_COOKIE_NAME } =
  await import("@/lib/config/constants");
const { signPendingToken } = await import("@/lib/auth/pending-2fa");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { POST } = await import("@/app/api/v3/auth/2fa/email-send/route");

// email-send now derives the userId only from a signed pending cookie.
process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);
function signedPending(userId: number, ts: number = Date.now()): string {
  return signPendingToken({ userId, ts });
}

function req(cookies: Record<string, string> = {}, body?: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/2fa/email-send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join("; "),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function signIn(overrides: Record<string, unknown> = {}) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow({ email: "oauth@example.com", ...overrides });
}

beforeEach(() => {
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  cookieState.clear();
  sessionRow = null;
  userEmailRow = null;
  recentCodeRow = null;
  deleteCodeCalls = [];
  insertCodeCalls = [];
  cooldownCalls = [];
  emailConfigured = true;
});

describe("POST /api/v3/auth/2fa/email-send", () => {
  it("rejects when there is no pending 2FA cookie at all", async () => {
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  it("rejects an expired Discord pending login", async () => {
    const pending = signedPending(1, Date.now() - 6 * 60 * 1000);
    const res = await POST(req({ discord_pending_login: pending }));
    expect(res.status).toBe(401);
  });

  it("rejects when the pending user can't be found", async () => {
    userEmailRow = null;
    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );
    expect(res.status).toBe(400);
  });

  it("rate limits a second request within 60 seconds", async () => {
    userEmailRow = { email: "user@example.com" };
    recentCodeRow = { created_at: new Date().toISOString() };

    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );

    expect(res.status).toBe(429);
    expect(insertCodeCalls).toHaveLength(0);
  });

  it("sends a fresh code, storing a salted hash rather than the plaintext", async () => {
    userEmailRow = { email: "user@example.com" };
    recentCodeRow = null;

    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.maskedEmail).toBe("us***@example.com");
    // Only sign-in codes are replaced: a step-up code in flight survives.
    expect(deleteCodeCalls).toEqual([[1, "login"]]);
    expect(insertCodeCalls).toHaveLength(1);
    const [userId, codeHash, codeSalt, , purpose] = insertCodeCalls[0];
    expect(userId).toBe(1);
    expect(purpose).toBe("login");
    expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codeSalt).toMatch(/^[a-f0-9]{64}$/);
    expect(codeHash).not.toBe(codeSalt);

    // sendEmail is awaited directly (not backgrounded) by this route.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("tells the user the lifetime the code was stored with", async () => {
    settingsRows = [{ key: "EMAIL_2FA_CODE_EXPIRY_MINUTES", value: "3" }];
    invalidateSettingsCache();
    userEmailRow = { email: "user@example.com" };

    const res = await POST(
      req({ [AUTH_2FA_PENDING_COOKIE]: signedPending(1) }),
    );

    settingsRows = [];
    invalidateSettingsCache();
    expect(res.status).toBe(200);
    expect(insertCodeCalls[0][3]).toBe(3);
    expect((mockSendEmail.mock.calls[0][0] as { text: string }).text).toContain(
      "It expires in 3 minutes.",
    );
  });

  it("resolves the pending user from a fresh Discord pending login cookie", async () => {
    userEmailRow = { email: "discorduser@example.com" };
    const pending = signedPending(7);

    const res = await POST(req({ discord_pending_login: pending }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.maskedEmail).toBe("di***@example.com");
    expect(insertCodeCalls[0][0]).toBe(7);
  });

  // The verify route used to read these in the opposite order, so the code
  // went to one account and was checked against another. Both now take the
  // newest first factor (tests/app/api/v3/auth/2fa/verify asks the same).
  it("mails the newest sign-in when a password and an OAuth pending cookie are both present", async () => {
    userEmailRow = { email: "user@example.com" };
    const now = Date.now();
    const res = await POST(
      req({
        [AUTH_2FA_PENDING_COOKIE]: signedPending(2, now - 60_000),
        oauth_pending_login: signedPending(1, now),
      }),
    );
    expect(res.status).toBe(200);
    expect(insertCodeCalls[0][0]).toBe(1);
  });
});

describe("POST /api/v3/auth/2fa/email-send { purpose: 'reauth' }", () => {
  it("answers 401 without a session, whatever pending cookie is present", async () => {
    const res = await POST(
      req(
        { [AUTH_2FA_PENDING_COOKIE]: signedPending(1) },
        { purpose: "reauth" },
      ),
    );
    expect(res.status).toBe(401);
    expect(insertCodeCalls).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("is refused while impersonating", async () => {
    signIn({ impersonated_by: 99 });
    const res = await POST(req({}, { purpose: "reauth" }));
    expect(res.status).toBe(403);
    expect((await res.json()).impersonationBlocked).toBe(true);
    expect(insertCodeCalls).toHaveLength(0);
  });

  it("mails a 10-minute step-up code to the session's own address", async () => {
    signIn({ user_id: 5 });
    const res = await POST(req({}, { purpose: "reauth" }));

    expect(res.status).toBe(200);
    expect((await res.json()).maskedEmail).toBe("oa***@example.com");
    expect(deleteCodeCalls).toEqual([[5, "reauth"]]);
    expect(cooldownCalls[0]).toEqual([5, expect.any(Number), "reauth"]);
    const [userId, codeHash, , expiry, purpose] = insertCodeCalls[0];
    expect(userId).toBe(5);
    expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(expiry).toBe(10);
    expect(purpose).toBe("reauth");

    const mail = mockSendEmail.mock.calls[0][0] as {
      to: string;
      subject: string;
      text: string;
      template: string;
    };
    expect(mail.to).toBe("oauth@example.com");
    expect(mail.template).toBe("stepUpCode");
    expect(mail.subject).not.toMatch(/\d{6}/);
    expect(mail.text).toContain("It expires in 10 minutes.");
  });

  it("holds the resend cooldown", async () => {
    signIn();
    recentCodeRow = { created_at: new Date().toISOString() };
    const res = await POST(req({}, { purpose: "reauth" }));
    expect(res.status).toBe(429);
    expect(insertCodeCalls).toHaveLength(0);
  });

  it("answers 409 with emailConfigured false on a server that cannot send mail", async () => {
    emailConfigured = false;
    signIn();
    const res = await POST(req({}, { purpose: "reauth" }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.emailConfigured).toBe(false);
    expect(json.error).toMatch(/sign in again/i);
    expect(insertCodeCalls).toHaveLength(0);
  });
});
