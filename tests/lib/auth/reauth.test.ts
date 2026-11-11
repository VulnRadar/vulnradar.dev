/**
 * verifyReauthPassword is the step-up gate in front of every sensitive account
 * action: 2FA setup, backup codes, turning 2FA off, email codes, setting a
 * password or changing the email, linking a provider, and the admin actions.
 *
 * An account created through Google, GitHub or Discord has no password, and the
 * gate used to wave it through on the session alone. A stolen session cookie
 * was then enough to change the email, set a password and switch 2FA off. Now
 * such an account passes only with a step-up cookie minted by a mailed code for
 * this user and this session, or, when the server cannot send mail, with a
 * session that is itself a fresh sign-in.
 */
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.API_KEY_ENCRYPTION_KEY = "d".repeat(64);

const cookieState = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieState.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: () => {},
    delete: () => {},
  })),
  headers: vi.fn(async () => ({ get: () => null })),
}));

let passwordHash: string | null = null;
let userMissing = false;
let freshSession = false;
const queries: { sql: string; params: unknown[] }[] = [];
vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("SELECT password_hash FROM users")) {
        return { rows: userMissing ? [] : [{ password_hash: passwordHash }] };
      }
      if (sql.includes("FROM sessions")) {
        return { rows: freshSession ? [{ fresh: true }] : [] };
      }
      return { rows: [] };
    }),
  },
}));

let emailConfigured = true;
vi.mock("@/lib/email/email", () => ({
  isEmailConfigured: () => emailConfigured,
}));

const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { hashPassword } = await import("@/lib/auth/password-hash");
const reauth = await import("@/lib/auth/reauth");
const { verifyReauthPassword, signStepUpToken, STEP_UP_COOKIE } = reauth;

const MESSAGES = { missing: "Password is required.", wrong: "Wrong password." };
const SESSION_TOKEN = "session-token-of-the-signed-in-browser";
const SESSION_ID = createHash("sha256").update(SESSION_TOKEN).digest("hex");

beforeEach(() => {
  cookieState.clear();
  cookieState.set(AUTH_SESSION_COOKIE_NAME, SESSION_TOKEN);
  passwordHash = null;
  userMissing = false;
  freshSession = false;
  emailConfigured = true;
  queries.length = 0;
});

describe("an account with no password", () => {
  it("is refused with stepUp when there is no step-up cookie", async () => {
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, status: 403, stepUp: true });
  });

  it("is refused on a step-up cookie minted for another session", async () => {
    const other = createHash("sha256").update("another-browser").digest("hex");
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(1, other));
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  it("is refused on a step-up cookie minted for another user", async () => {
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(2, SESSION_ID));
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  it("is refused on a step-up cookie older than ten minutes", async () => {
    cookieState.set(
      STEP_UP_COOKIE,
      signStepUpToken(1, SESSION_ID, Date.now() - 10 * 60 * 1000 - 1),
    );
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  it("is refused on a forged step-up cookie", async () => {
    const forged = Buffer.from(
      JSON.stringify({ userId: 1, ts: Date.now() }),
    ).toString("base64url");
    cookieState.set(STEP_UP_COOKIE, `${forged}.deadbeef`);
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  it("is refused when there is no session cookie at all", async () => {
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(1, SESSION_ID));
    cookieState.delete(AUTH_SESSION_COOKIE_NAME);
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  it("passes with a valid step-up cookie for this user and session", async () => {
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(1, SESSION_ID));
    expect(await verifyReauthPassword(1, undefined, MESSAGES)).toEqual({
      ok: true,
    });
  });

  it("does not pass on a fresh session while the server can send mail", async () => {
    freshSession = true;
    const result = await verifyReauthPassword(1, undefined, MESSAGES);
    expect(result).toMatchObject({ ok: false, stepUp: true });
  });

  describe("on a server that cannot send mail", () => {
    beforeEach(() => {
      emailConfigured = false;
    });

    it("passes on a session created in the last ten minutes", async () => {
      freshSession = true;
      expect(await verifyReauthPassword(1, undefined, MESSAGES)).toEqual({
        ok: true,
      });
      const check = queries.find((q) => q.sql.includes("FROM sessions"))!;
      expect(check.params).toEqual([SESSION_ID, 1, 600]);
      expect(check.sql).toMatch(/created_at > NOW\(\)/);
      // An impersonation session is staff opening the account, not the
      // owner signing in, so it never counts as the fresh sign-in.
      expect(check.sql).toMatch(/impersonated_by IS NULL/);
    });

    it("tells an older session to sign in again", async () => {
      const result = await verifyReauthPassword(1, undefined, MESSAGES);
      expect(result).toMatchObject({ ok: false, status: 403, stepUp: true });
      expect(!result.ok && result.error).toMatch(/sign in again/i);
    });
  });
});

describe("an account with a password", () => {
  beforeEach(async () => {
    passwordHash = await hashPassword("correct horse");
  }, 20_000);

  it("still needs the password when it holds a valid step-up cookie", async () => {
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(1, SESSION_ID));
    expect(await verifyReauthPassword(1, undefined, MESSAGES)).toEqual({
      ok: false,
      status: 400,
      error: MESSAGES.missing,
    });
  });

  it("is refused on a wrong password and passes on the right one", async () => {
    expect(await verifyReauthPassword(1, "nope", MESSAGES)).toEqual({
      ok: false,
      status: 403,
      error: MESSAGES.wrong,
    });
    expect(await verifyReauthPassword(1, "correct horse", MESSAGES)).toEqual({
      ok: true,
    });
  });
});

it("fails closed on a session whose user row is gone", async () => {
  userMissing = true;
  cookieState.set(STEP_UP_COOKIE, signStepUpToken(1, SESSION_ID));
  expect(await verifyReauthPassword(1, undefined, MESSAGES)).toEqual({
    ok: false,
    status: 403,
    error: MESSAGES.wrong,
  });
});

/**
 * Each route that moved onto the helper kept the statuses it always answered,
 * and every one of them now carries `stepUp: true` on a missing step-up. Five
 * of the callers built their own response from `{ error }` alone, which is
 * what left an account with no password looking at a password field.
 */
describe("reauthRefusal", () => {
  const { reauthRefusal } = reauth;
  const stepUp = {
    ok: false as const,
    status: 403 as const,
    error: "Confirm it is you with a code from your email first.",
    stepUp: true as const,
  };
  const missing = { ok: false as const, status: 400 as const, error: "m" };
  const wrong = { ok: false as const, status: 403 as const, error: "w" };

  it("answers a missing step-up with 403 and stepUp, whatever the route's pair", async () => {
    for (const res of [
      reauthRefusal(stepUp),
      reauthRefusal(stepUp, 401),
      reauthRefusal(stepUp, 403, 403),
      reauthRefusal(stepUp, 400, 400),
    ]) {
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.stepUp).toBe(true);
      expect(json.error).toBe(stepUp.error);
    }
  });

  it("keeps each route's own statuses for a missing and a wrong password", async () => {
    expect(reauthRefusal(missing).status).toBe(400);
    expect(reauthRefusal(wrong).status).toBe(403);
    expect(reauthRefusal(wrong, 401).status).toBe(401);
    // The admin routes answer both with 403.
    expect(reauthRefusal(missing, 403, 403).status).toBe(403);
    // Account deletion answers both with 400.
    expect(reauthRefusal(wrong, 400, 400).status).toBe(400);
    expect((await reauthRefusal(wrong).json()).stepUp).toBeUndefined();
  });
});
