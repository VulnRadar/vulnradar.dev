/**
 * verifyStaffSecondFactor is the second factor in front of the two staff
 * powers that reach furthest: applying an update (code on the host) and
 * signing in as a customer. Both used to need the staff password alone, and
 * ENFORCE_STAFF_2FA ships off, so one stolen staff password was enough for
 * either. The helper runs whatever that setting says.
 *
 * Each branch: no two-factor at all, an authenticator code (wrong, replayed,
 * already used at sign-in, a backup code instead, valid), and email codes
 * (the step-up cookie for this session, one minted for another session, and
 * an account with no password, where the mailbox would be both factors).
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

interface Row {
  password_hash: string | null;
  totp_enabled: boolean;
  totp_secret: string | null;
  two_factor_method: string | null;
}
let row: Row | null = null;
let lastCounter: string | null = null;
let freshSession = false;
const clientQueries: string[] = [];

vi.mock("@/lib/database/db", () => ({
  default: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM users WHERE id")) {
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM sessions")) {
        return { rows: freshSession ? [{ fresh: true }] : [] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        clientQueries.push(sql);
        if (sql.includes("SELECT totp_last_counter")) {
          return { rows: [{ totp_last_counter: lastCounter }] };
        }
        if (sql.includes("UPDATE users SET totp_last_counter")) {
          lastCounter = String(params[0]);
        }
        return { rows: [] };
      }),
      release: () => {},
    })),
  },
}));

let emailConfigured = true;
vi.mock("@/lib/email/email", () => ({
  isEmailConfigured: () => emailConfigured,
}));

const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { encryptApiKey } = await import("@/lib/auth/crypto");
const { generateSecret, generateTOTP } = await import("@/lib/auth/totp");
const { signStepUpToken, STEP_UP_COOKIE } = await import("@/lib/auth/reauth");
const { verifyStaffSecondFactor, secondFactorRefusal, SECOND_FACTOR_REQUIRED } =
  await import("@/lib/auth/staff-step-up");

const SESSION_TOKEN = "session-token-of-the-staff-browser";
const SESSION_ID = createHash("sha256").update(SESSION_TOKEN).digest("hex");
const SECRET = generateSecret();
const session = { userId: 7 };

function totpAccount(over: Partial<Row> = {}): Row {
  return {
    password_hash: "scrypt$stored",
    totp_enabled: true,
    totp_secret: encryptApiKey(SECRET),
    two_factor_method: "app",
    ...over,
  };
}

beforeEach(() => {
  cookieState.clear();
  cookieState.set(AUTH_SESSION_COOKIE_NAME, SESSION_TOKEN);
  row = null;
  lastCounter = null;
  freshSession = false;
  emailConfigured = true;
  clientQueries.length = 0;
});

describe("an account without two-factor", () => {
  it("is refused with secondFactor none, whatever ENFORCE_STAFF_2FA says", async () => {
    row = {
      password_hash: "scrypt$stored",
      totp_enabled: false,
      totp_secret: null,
      two_factor_method: null,
    };
    const result = await verifyStaffSecondFactor(session, {
      totpCode: "123456",
    });
    expect(result).toEqual({
      ok: false,
      secondFactor: "none",
      error:
        "Turn on two-step sign-in under Profile > Security to apply updates or impersonate.",
    });
  });

  it("fails closed on a missing users row", async () => {
    row = null;
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "none" });
  });
});

describe("an authenticator account", () => {
  it("passes on the current code and records its step", async () => {
    row = totpAccount();
    const result = await verifyStaffSecondFactor(session, {
      totpCode: generateTOTP(SECRET),
    });
    expect(result).toEqual({ ok: true });
    expect(lastCounter).not.toBeNull();
  });

  it("refuses a wrong code", async () => {
    row = totpAccount();
    const code = generateTOTP(SECRET);
    const wrong = code === "000000" ? "111111" : "000000";
    const result = await verifyStaffSecondFactor(session, { totpCode: wrong });
    expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
    expect(lastCounter).toBeNull();
  });

  it("refuses a missing or malformed code", async () => {
    row = totpAccount();
    for (const body of [{}, { totpCode: 123456 }, { totpCode: "12345" }]) {
      const result = await verifyStaffSecondFactor(session, body);
      expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
    }
  });

  it("refuses the same code twice", async () => {
    row = totpAccount();
    const code = generateTOTP(SECRET);
    expect(await verifyStaffSecondFactor(session, { totpCode: code })).toEqual({
      ok: true,
    });
    const replay = await verifyStaffSecondFactor(session, { totpCode: code });
    expect(replay).toMatchObject({ ok: false, secondFactor: "totp" });
    expect(replay.ok === false && replay.error).toMatch(/already used/i);
  });

  it("refuses a code whose step was already used at sign-in", async () => {
    row = totpAccount();
    const code = generateTOTP(SECRET);
    // The sign-in verifier advanced totp_last_counter to this step. Read the
    // clock after the code, so a step boundary between the two still leaves
    // the stored step at or past the code's.
    lastCounter = String(Math.floor(Date.now() / 1000 / 30));
    const result = await verifyStaffSecondFactor(session, { totpCode: code });
    expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
    expect(clientQueries.some((q) => q.includes("FOR UPDATE"))).toBe(true);
  });

  it("does not accept a backup code, and says so", async () => {
    row = totpAccount();
    const result = await verifyStaffSecondFactor(session, {
      backupCode: "ABCD-EFGH",
    });
    expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
    expect(result.ok === false && result.error).toMatch(
      /backup codes are not accepted/i,
    );
  });

  it("ignores the email step-up cookie: it is not an authenticator code", async () => {
    row = totpAccount();
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(7, SESSION_ID));
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
  });

  it("refuses a legacy plaintext seed rather than trusting it", async () => {
    row = totpAccount({ totp_secret: `plain:${SECRET}` });
    const result = await verifyStaffSecondFactor(session, {
      totpCode: generateTOTP(SECRET),
    });
    expect(result).toMatchObject({ ok: false, secondFactor: "totp" });
  });

  it("works for an account with no password: the mailed step-up was the first factor", async () => {
    row = totpAccount({ password_hash: null });
    const result = await verifyStaffSecondFactor(session, {
      totpCode: generateTOTP(SECRET),
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("an email-code account with a password", () => {
  it("passes with the step-up cookie for this session", async () => {
    row = totpAccount({ two_factor_method: "email", totp_secret: null });
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(7, SESSION_ID));
    expect(await verifyStaffSecondFactor(session, {})).toEqual({ ok: true });
  });

  it("is refused without the cookie", async () => {
    row = totpAccount({ two_factor_method: "email", totp_secret: null });
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "email" });
  });

  it("is refused on a step-up cookie minted for another session", async () => {
    row = totpAccount({ two_factor_method: "email", totp_secret: null });
    cookieState.set(
      STEP_UP_COOKIE,
      signStepUpToken(7, "some-other-session-id"),
    );
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "email" });
  });

  it("is refused on a step-up cookie minted for another account", async () => {
    row = totpAccount({ two_factor_method: "email", totp_secret: null });
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(8, SESSION_ID));
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "email" });
  });

  it("does not take a fresh sign-in in place of the code when mail is off", async () => {
    row = totpAccount({ two_factor_method: "email", totp_secret: null });
    emailConfigured = false;
    freshSession = true;
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toMatchObject({ ok: false, secondFactor: "authenticator" });
  });
});

describe("an email-code account with no password", () => {
  it("is refused even with the cookie: the mailbox would be both factors", async () => {
    row = {
      password_hash: null,
      totp_enabled: true,
      totp_secret: null,
      two_factor_method: "email",
    };
    cookieState.set(STEP_UP_COOKIE, signStepUpToken(7, SESSION_ID));
    const result = await verifyStaffSecondFactor(session, {});
    expect(result).toEqual({
      ok: false,
      secondFactor: "authenticator",
      error:
        "Add an authenticator app to apply updates or impersonate from an account without a password.",
    });
  });
});

describe("secondFactorRefusal", () => {
  it("is a 403 naming the code and the factor", async () => {
    const res = secondFactorRefusal({
      ok: false,
      secondFactor: "totp",
      error: "Nope.",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "Nope.",
      code: SECOND_FACTOR_REQUIRED,
      secondFactor: "totp",
    });
  });
});
