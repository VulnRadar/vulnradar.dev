import { dataUrl, realPng } from "../../../../../lib/uploads/_avatar-fixtures";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for PATCH /api/v3/auth/update.
 *
 * Mocked at the network/database boundary only (see tests/README.md): the
 * pg pool and outbound email sends. getSession, verifyPassword,
 * hashPassword, deleteAllSessions, createSession, checkRateLimit,
 * validateAvatarDataUrl, and the real avatar-storage code all run for real
 * against the mocked pool and a fake next/headers cookie/header store.
 * Avatars live in the user_avatars table now, so an avatar upload is an
 * INSERT the mocked pool records (avatarStoreCalls) rather than a file on
 * disk, and clearing/switching issues a DELETE (avatarDeleteCalls).
 */

const queries: { sql: string; params: unknown[] }[] = [];
const rateLimitCounts = new Map<string, number>();

let sessionRow: Record<string, unknown> | null = null;
let passwordHashRow: { password_hash: string | null } | null = null;
let currentUserRow: { name: string; email: string } | null = null;
let existingEmailOwnerRow: { id: number } | null = null;
let updatedUserRow: Record<string, unknown> | null = null;

let nameUpdateCalls: unknown[][] = [];
let emailUpdateCalls: unknown[][] = [];
let pendingEmailCalls: unknown[][] = [];
let avatarUpdateCalls: unknown[][] = [];
let avatarStoreCalls: unknown[][] = [];
let avatarDeleteCalls: unknown[][] = [];
let passwordUpdateCalls: unknown[][] = [];
let sessionDeleteCalls: unknown[][] = [];
let sessionInsertCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.startsWith("DELETE FROM sessions WHERE id")) return { rows: [] };
  if (s.includes("SELECT s.user_id")) {
    return { rows: sessionRow ? [sessionRow] : [] };
  }
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
  if (s === "SELECT password_hash FROM users WHERE id = $1") {
    return { rows: passwordHashRow ? [passwordHashRow] : [] };
  }
  if (s === "SELECT name, email FROM users WHERE id = $1") {
    return { rows: currentUserRow ? [currentUserRow] : [] };
  }
  if (s.startsWith("UPDATE users SET name = $1 WHERE id = $2")) {
    nameUpdateCalls.push(params);
    return { rows: [] };
  }
  if (
    s.startsWith("SELECT id FROM users WHERE") &&
    s.endsWith("AND id != $2")
  ) {
    return { rows: existingEmailOwnerRow ? [existingEmailOwnerRow] : [] };
  }
  // Any write to the address itself, however it is spelled. A pending change
  // must never issue one.
  if (/^UPDATE users SET (.*[ ,])?email\s*=/.test(s)) {
    emailUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET pending_email = $1")) {
    pendingEmailCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET avatar_url = $1 WHERE id = $2")) {
    avatarUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO user_avatars")) {
    avatarStoreCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM user_avatars")) {
    avatarDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET password_hash = $1 WHERE id = $2")) {
    passwordUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM sessions WHERE user_id = $1")) {
    sessionDeleteCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("INSERT INTO sessions")) {
    sessionInsertCalls.push(params);
    return { rows: [] };
  }
  if (
    s.startsWith("SELECT id, email, name, avatar_url FROM users WHERE id = $1")
  ) {
    return { rows: updatedUserRow ? [updatedUserRow] : [] };
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

// Issuing the new verification link is the real code unless a test makes it
// fail, which is the case the email change has to stay safe under.
let issueVerificationError: Error | null = null;
vi.mock("@/lib/auth/email-verification", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/email-verification")>();
  return {
    ...actual,
    sendEmailVerification: async (
      ...args: Parameters<typeof actual.sendEmailVerification>
    ) => {
      if (issueVerificationError) throw issueVerificationError;
      return actual.sendEmailVerification(...args);
    },
  };
});

// The re-auth check is the real one unless a case stands in for the step-up a
// password-less account has to pass, which lib/auth/reauth.ts reads from its
// own cookie. What this suite proves is that the route obeys whatever that
// check answers, for both writes it guards.
type ReauthOutcome = Awaited<
  ReturnType<typeof import("@/lib/auth/reauth").verifyReauthPassword>
>;
let reauthOverride: ReauthOutcome | null = null;
const reauthCalls: unknown[][] = [];
vi.mock("@/lib/auth/reauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/reauth")>();
  return {
    ...actual,
    verifyReauthPassword: async (
      ...args: Parameters<typeof actual.verifyReauthPassword>
    ) => {
      reauthCalls.push(args);
      if (reauthOverride) return reauthOverride;
      return actual.verifyReauthPassword(...args);
    },
  };
});

const { store: cookieStore, state: cookieState } = makeCookieStore();
const { store: headerStore, state: headerState } = makeHeaderStore();

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => headerStore),
}));

const mockSendEmail = vi.fn(async (_params: unknown) => {});
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: (params: Parameters<typeof actual.sendEmail>[0]) =>
      mockSendEmail(params),
  };
});

const { hashPassword } = await import("@/lib/auth/password-hash");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { PATCH } = await import("@/app/api/v3/auth/update/route");

const CURRENT_PASSWORD = "Existing-Password-42!";
let currentPasswordHash: string;

beforeAll(async () => {
  currentPasswordHash = await hashPassword(CURRENT_PASSWORD);
}, 20_000);

function updateRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/auth/update", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest-agent",
    },
    body: JSON.stringify(body),
  });
}

function logIn(userId = 7) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow({
    user_id: userId,
    email: "user@example.com",
  });
}

beforeEach(async () => {
  // Drain any background setImmediate email sends left pending by the
  // previous test before resetting mocks, so a leftover callback can't
  // fire mid-test and inflate a call count assertion.
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  rateLimitCounts.clear();
  cookieState.clear();
  headerState.clear();
  sessionRow = null;
  passwordHashRow = { password_hash: currentPasswordHash };
  currentUserRow = { name: "Original Name", email: "user@example.com" };
  existingEmailOwnerRow = null;
  updatedUserRow = {
    id: 7,
    email: "user@example.com",
    name: "Original Name",
    avatar_url: null,
  };
  nameUpdateCalls = [];
  emailUpdateCalls = [];
  pendingEmailCalls = [];
  reauthOverride = null;
  reauthCalls.length = 0;
  avatarUpdateCalls = [];
  avatarStoreCalls = [];
  avatarDeleteCalls = [];
  passwordUpdateCalls = [];
  sessionDeleteCalls = [];
  sessionInsertCalls = [];
  issueVerificationError = null;
  invalidateSettingsCache();
});

describe("PATCH /api/v3/auth/update", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await PATCH(updateRequest({ name: "New Name" }));
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users"),
      expect.anything(),
    );
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a JSON null", "null"],
    ["a JSON array", "[]"],
    ["a JSON string", '"name"'],
  ])("answers %s with a 400 and changes nothing", async (_label, raw) => {
    logIn();
    const res = await PATCH(
      new NextRequest("http://localhost/api/v3/auth/update", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: raw,
      }),
    );
    expect(res.status).toBe(400);
    expect(nameUpdateCalls).toHaveLength(0);
    expect(emailUpdateCalls).toHaveLength(0);
  });

  it("answers 400 for a new password that is not text, before checking the current one", async () => {
    logIn();
    const res = await PATCH(
      updateRequest({ newPassword: 123456789012, currentPassword: "x" }),
    );
    expect(res.status).toBe(400);
    expect(rateLimitCounts.get("profile-reauth:7:unknown")).toBeUndefined();
  });

  it("says when to retry once the current-password check is rate limited", async () => {
    logIn();
    rateLimitCounts.set("profile-reauth:7:unknown", 100);

    const res = await PATCH(
      updateRequest({
        email: "new@example.com",
        currentPassword: CURRENT_PASSWORD,
      }),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(emailUpdateCalls).toHaveLength(0);
  });

  it("rate limits repeated update attempts", async () => {
    logIn();
    rateLimitCounts.set("profile-update:7:unknown", 100); // RATE_LIMITS.api maxAttempts is well under 100

    const res = await PATCH(
      updateRequest({ name: "New Name", currentPassword: CURRENT_PASSWORD }),
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(nameUpdateCalls).toHaveLength(0);
  });

  // Only email and password changes are account-takeover vectors (a
  // stolen session cookie changing your email, then triggering a
  // password reset, is the threat this gate exists for -- see the
  // route's own comment on `sensitiveChangeRequested`). Name and avatar
  // are not, and previously had no way to supply a currentPassword at
  // all in the general profile tab UI, so this gate silently blocked
  // every name/avatar change for any account with a password. See the
  // "name" and "avatar" describe blocks below for the fixed behavior.
  it("requires the current password for an email change", async () => {
    logIn();
    const res = await PATCH(updateRequest({ email: "new@example.com" }));
    // A missing password is a 400, the status verifyReauthPassword gives it,
    // and not the 403 a wrong one gets.
    expect(res.status).toBe(400);
    expect(emailUpdateCalls).toHaveLength(0);
    expect(pendingEmailCalls).toHaveLength(0);
  });

  // sec-auth-8. An account with no password used to pass on the session
  // alone, so a stolen cookie could move the address and set a first
  // password: a full, persistent takeover. The step-up lives inside
  // verifyReauthPassword; this route has to ask it for both writes and obey a
  // refusal, rather than reading password_hash itself.
  describe("an account with no password", () => {
    const STEP_UP_REFUSAL = {
      ok: false,
      status: 403,
      error: "Confirm it is you with a code from your email first.",
      stepUp: true,
    } as unknown as ReauthOutcome;

    it.each([
      ["an email change", { email: "new-address@example.com" }],
      ["a first password", { newPassword: "Another-Strong-Password-9!" }],
    ])(
      "refuses %s without a step-up and writes nothing",
      async (_label, body) => {
        logIn();
        passwordHashRow = { password_hash: null };
        reauthOverride = STEP_UP_REFUSAL;

        const res = await PATCH(updateRequest(body));
        const json = await res.json();

        expect(res.status).toBe(403);
        expect(json.stepUp).toBe(true);
        expect(reauthCalls).toHaveLength(1);
        expect(reauthCalls[0][0]).toBe(7);
        expect(queries.some((q) => q.sql.startsWith("UPDATE users"))).toBe(
          false,
        );
        expect(
          queries.some((q) =>
            q.sql.startsWith("INSERT INTO email_verification_tokens"),
          ),
        ).toBe(false);
      },
    );

    it("takes the email change once the step-up holds", async () => {
      logIn();
      passwordHashRow = { password_hash: null };
      reauthOverride = { ok: true };

      const res = await PATCH(
        updateRequest({ email: "new-address@example.com" }),
      );

      expect(res.status).toBe(200);
      expect(pendingEmailCalls).toEqual([["new-address@example.com", 7]]);
    });

    it("sets a first password once the step-up holds", async () => {
      logIn();
      passwordHashRow = { password_hash: null };
      reauthOverride = { ok: true };

      const res = await PATCH(
        updateRequest({ newPassword: "Another-Strong-Password-9!" }),
      );

      expect(res.status).toBe(200);
      expect(passwordUpdateCalls).toHaveLength(1);
    }, 15_000);
  });

  it("answers a wrong password with 403 and counts it against the re-auth bucket", async () => {
    logIn();
    const res = await PATCH(
      updateRequest({
        email: "new-address@example.com",
        currentPassword: "totally-wrong",
      }),
    );
    expect(res.status).toBe(403);
    expect(rateLimitCounts.get("profile-reauth:7:unknown")).toBe(1);
    expect(pendingEmailCalls).toHaveLength(0);
  });

  // The re-auth gate fails closed. A session whose users row is gone used to
  // read as "no password set" (the OAuth-only rule) and skip the check.
  it("refuses an email change when the account's row cannot be read", async () => {
    logIn();
    passwordHashRow = null;
    const res = await PATCH(
      updateRequest({
        email: "new@example.com",
        currentPassword: CURRENT_PASSWORD,
      }),
    );
    expect(res.status).toBe(403);
    expect(emailUpdateCalls).toHaveLength(0);
  });

  it("rejects an incorrect current password on an email change", async () => {
    logIn();
    const res = await PATCH(
      updateRequest({
        email: "new@example.com",
        currentPassword: "totally-wrong",
      }),
    );
    expect(res.status).toBe(403);
    expect(emailUpdateCalls).toHaveLength(0);
  });

  describe("name", () => {
    it("rejects an empty name", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({ name: "   ", currentPassword: CURRENT_PASSWORD }),
      );
      expect(res.status).toBe(400);
    });

    // users.name is VARCHAR(255). Unchecked, a longer name reached the UPDATE,
    // Postgres refused it, and the client got a 500 for a typing mistake.
    it("refuses a name over MAX_NAME_LENGTH with a 400, before any write", async () => {
      logIn();
      const res = await PATCH(updateRequest({ name: "n".repeat(300) }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/Name cannot exceed 255 characters/);
      expect(nameUpdateCalls).toHaveLength(0);
    });

    it("refuses a name that is not text", async () => {
      logIn();
      const res = await PATCH(updateRequest({ name: 12345 }));
      expect(res.status).toBe(400);
      expect(nameUpdateCalls).toHaveLength(0);
    });

    it("updates the name and queues a change notification", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({ name: "New Name", currentPassword: CURRENT_PASSWORD }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.name ?? updatedUserRow?.name).toBeDefined();
      expect(nameUpdateCalls).toHaveLength(1);
      expect(nameUpdateCalls[0]).toEqual(["New Name", 7]);

      await new Promise((resolve) => setImmediate(resolve));
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("does not issue an UPDATE when the name is unchanged", async () => {
      logIn();
      await PATCH(
        updateRequest({
          name: "Original Name",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(nameUpdateCalls).toHaveLength(0);
    });

    // Regression test: the general profile tab UI never collects or sends
    // currentPassword for a name change (only the dedicated change-password
    // form has that field), so requiring it here silently blocked every
    // name change for any account with a password.
    it("updates the name with no currentPassword at all", async () => {
      logIn();
      const res = await PATCH(updateRequest({ name: "New Name" }));
      expect(res.status).toBe(200);
      expect(nameUpdateCalls).toEqual([["New Name", 7]]);
    });
  });

  describe("email", () => {
    it("rejects a malformed email", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: "not-an-email",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(400);
      expect(emailUpdateCalls).toHaveLength(0);
      expect(pendingEmailCalls).toHaveLength(0);
    });

    it("rejects an email already taken by another account", async () => {
      logIn();
      existingEmailOwnerRow = { id: 999 };
      const res = await PATCH(
        updateRequest({
          email: "taken@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(409);
      expect(emailUpdateCalls).toHaveLength(0);
      expect(pendingEmailCalls).toHaveLength(0);
    });

    // users has a unique index on LOWER(email), so "Taken@Example.com" and
    // "taken@example.com" are the same account. A case-sensitive pre-check
    // let a stored mixed-case address through to the UPDATE, which then
    // failed on the index as a 500 instead of answering 409.
    it("checks whether the address is taken case-insensitively, like the unique index", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: " Taken@Example.com ",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);
      const check = queries.find(
        (q) =>
          q.sql.startsWith("SELECT id FROM users WHERE") &&
          q.sql.endsWith("AND id != $2"),
      );
      expect(check?.sql).toBe(
        "SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2",
      );
      expect(check?.params).toEqual(["taken@example.com", 7]);
    });

    it.each([
      "two@signs@example.com",
      "user@localhost",
      "first last@example.com",
    ])("refuses an implausible new address: %s", async (address) => {
      logIn();
      const res = await PATCH(
        updateRequest({ email: address, currentPassword: CURRENT_PASSWORD }),
      );
      expect(res.status).toBe(400);
      expect(emailUpdateCalls).toHaveLength(0);
    });

    // The rule is for new input. An account stored under the old any-@ rule
    // that sends its own address back (beside a name change, say) is not
    // asking for anything the stricter rule is about.
    it("does not refuse the address the account already holds", async () => {
      logIn();
      currentUserRow = { name: "Original Name", email: "admin@localhost" };
      const res = await PATCH(
        updateRequest({
          name: "New Name",
          email: " Admin@Localhost ",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);
      expect(nameUpdateCalls).toEqual([["New Name", 7]]);
      expect(emailUpdateCalls).toHaveLength(0);
    });

    // sec-auth-3 and bug-messaging-3. The change used to land at once: the
    // account moved to an address nobody had proved, lost its verified flag,
    // and every scan alert, invite and reset link went to whatever was typed.
    // A typo stranded the owner; someone else's address was squatted. Now the
    // address waits in pending_email and the account keeps the one it has.
    it("holds a new address as pending and leaves email and email_verified_at alone", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: " New-Address@Example.com ",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(pendingEmailCalls).toEqual([["new-address@example.com", 7]]);
      expect(emailUpdateCalls).toHaveLength(0);
      expect(queries.some((q) => q.sql.includes("email_verified_at"))).toBe(
        false,
      );
      // The response still names the address the account signs in with, and
      // says which one is waiting.
      expect(json.email).toBe("user@example.com");
      expect(json.pendingEmail).toBe("new-address@example.com");
    });

    it("mails the link to the pending address, bound to that address", async () => {
      logIn();
      await PATCH(
        updateRequest({
          email: "new-address@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const issued = queries.find((q) =>
        q.sql.startsWith("INSERT INTO email_verification_tokens"),
      );
      expect(issued?.params[0]).toBe(7);
      expect(issued?.params[3]).toBe("new-address@example.com");

      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      // Only the link goes out now. "Your address was changed" would be false
      // until the link is opened, so verify-email sends it, to the old
      // address, when the change really happens.
      const sentTo = mockSendEmail.mock.calls.map(
        ([p]) => (p as { to: string }).to,
      );
      expect(sentTo).toEqual(["new-address@example.com"]);
      const [link] = mockSendEmail.mock.calls[0] as [{ text: string }];
      expect(link.text).toMatch(/\/verify-email\?token=[0-9a-f]{64}/);
    });

    it("does not hold the address the account already has, in another case, as pending", async () => {
      logIn();
      currentUserRow = { name: "Original Name", email: "User@Example.com" };
      const res = await PATCH(
        updateRequest({
          email: "user@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);
      expect(pendingEmailCalls).toHaveLength(0);
      expect(sessionDeleteCalls).toHaveLength(0);
    });

    it("rotates every other session and every trusted device on an email change", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: "new-address@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const json = await res.json();

      // Changing the login identifier is as takeover-relevant as changing
      // the password, which already did this. Without it a stolen cookie
      // could move the account to the attacker's address and keep every
      // other session, and every 2FA-skipping device_trust row, alive.
      expect(json.sessionInvalidated).toBe(true);
      expect(sessionDeleteCalls).toEqual([[7]]);
      expect(
        queries.some(
          (q) =>
            q.sql.startsWith("DELETE FROM device_trust") && q.params[0] === 7,
        ),
      ).toBe(true);
      // The caller is not signed out: a fresh session replaces the cookie.
      expect(sessionInsertCalls).toHaveLength(1);
      expect(res.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value).toBeTruthy();
    });

    // Changing the address and killing the links mailed to the old one are one
    // step. As two, a link clicked in between (or one that survived because
    // issuing the new link threw) verified the NEW address for someone who
    // only ever controlled the old one.
    it("clears the old verification links in the same transaction as the pending address", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: "new-address@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);

      const sqls = queries.map((q) => q.sql);
      const begin = sqls.indexOf("BEGIN");
      const update = sqls.findIndex((q) =>
        q.startsWith("UPDATE users SET pending_email = $1"),
      );
      const clear = sqls.findIndex((q) =>
        q.startsWith(
          "DELETE FROM email_verification_tokens WHERE user_id = $1",
        ),
      );
      const commit = sqls.indexOf("COMMIT");
      const issue = sqls.findIndex((q) =>
        q.startsWith("INSERT INTO email_verification_tokens"),
      );
      expect(begin).toBeGreaterThanOrEqual(0);
      expect(clear).toBeGreaterThan(begin);
      expect(update).toBeGreaterThan(clear);
      expect(commit).toBeGreaterThan(update);
      expect(issue).toBeGreaterThan(commit);
      expect(queries[clear].params).toEqual([7]);
    });

    it("leaves no old verification link live when issuing the new one fails", async () => {
      logIn();
      issueVerificationError = new Error("settings unavailable");
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await PATCH(
        updateRequest({
          email: "new-address@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );

      const sqls = queries.map((q) => q.sql);
      const clear = sqls.findIndex((q) =>
        q.startsWith(
          "DELETE FROM email_verification_tokens WHERE user_id = $1",
        ),
      );
      expect(clear).toBeGreaterThanOrEqual(0);
      expect(sqls.indexOf("COMMIT")).toBeGreaterThan(clear);
      // The pending address is recorded, so the rotation that goes with it
      // still runs and the caller is told the truth instead of a 500. Saving
      // the change again mails a new link.
      expect(res.status).toBe(200);
      expect(sessionDeleteCalls).toEqual([[7]]);
      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });

    it("does not rotate sessions when the submitted email is unchanged", async () => {
      logIn();
      await PATCH(
        updateRequest({
          email: "user@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );

      expect(emailUpdateCalls).toHaveLength(0);
      expect(sessionDeleteCalls).toHaveLength(0);
    });
  });

  describe("avatar", () => {
    const pngDataUrl = dataUrl("image/png", realPng(8, 8));

    it("allows clearing the avatar with an empty string", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({ avatarUrl: "", currentPassword: CURRENT_PASSWORD }),
      );
      expect(res.status).toBe(200);
      expect(avatarUpdateCalls).toEqual([[null, 7]]);
    });

    // Regression test: same gap as the name test above -- neither the crop
    // dialog's upload handler nor the "remove photo" button ever collected
    // or sent a currentPassword, so this 403'd for every account with a
    // password with no way to retry (see app/profile/page.tsx's
    // handleCroppedAvatar and components/profile/tabs/profile-general-tab.tsx's
    // handleRemoveAvatar).
    it("uploads a new avatar with no currentPassword at all", async () => {
      logIn();
      const res = await PATCH(updateRequest({ avatarUrl: pngDataUrl }));
      expect(res.status).toBe(200);
      expect(avatarUpdateCalls).toHaveLength(1);
      expect(avatarUpdateCalls[0][1]).toBe(7);
    });

    it("deletes any stored avatar row when clearing the avatar", async () => {
      logIn();
      await PATCH(
        updateRequest({ avatarUrl: "", currentPassword: CURRENT_PASSWORD }),
      );
      // Clearing issues a DELETE FROM user_avatars for this user so no row
      // is left behind, and nulls the column.
      expect(avatarDeleteCalls).toContainEqual([7]);
      expect(avatarUpdateCalls).toEqual([[null, 7]]);
    });

    // gap-uploads-and-connected-accounts-7. Anything that began with
    // https://cdn.discordapp.com/ was stored as the avatar as-is: another
    // user's picture, a file from any channel's attachments, or a URL of any
    // length, all outside the image checks. No screen sends one here: "use my
    // Discord picture" is PATCH /account/discord {syncAvatar: true}, which
    // builds the URL from the account's own linked Discord id.
    it.each([
      [
        "a Discord attachments URL",
        "https://cdn.discordapp.com/attachments/1/2/not-an-avatar.png",
      ],
      [
        "a 100 KB Discord URL",
        `https://cdn.discordapp.com/avatars/123/${"a".repeat(100_000)}.png`,
      ],
      [
        "another account's Discord avatar",
        "https://cdn.discordapp.com/avatars/123/abc.png",
      ],
      ["any other external URL", "https://example.com/me.png"],
    ])("refuses %s with a 400 and writes nothing", async (_label, url) => {
      logIn();
      const res = await PATCH(updateRequest({ avatarUrl: url }));

      expect(res.status).toBe(400);
      expect(avatarUpdateCalls).toHaveLength(0);
      expect(avatarStoreCalls).toHaveLength(0);
      expect(avatarDeleteCalls).toHaveLength(0);
    });

    it("rejects an SVG data URL avatar via the real validator (XSS vector)", async () => {
      logIn();
      const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)></svg>").toString("base64")}`;
      const res = await PATCH(
        updateRequest({
          avatarUrl: svgDataUrl,
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/SVG is not allowed/i);
      expect(avatarUpdateCalls).toHaveLength(0);
      expect(avatarStoreCalls).toHaveLength(0);
    });

    it("stores a valid PNG data URL avatar in user_avatars and points avatar_url at the serving route", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          avatarUrl: pngDataUrl,
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);

      // The validated bytes are upserted into user_avatars for user 7...
      expect(avatarStoreCalls).toHaveLength(1);
      expect(avatarStoreCalls[0][0]).toBe(7);
      expect(avatarStoreCalls[0][2]).toBe("image/png");

      // ...and avatar_url is set to the same-origin serving path.
      expect(avatarUpdateCalls).toHaveLength(1);
      const [storedValue, userId] = avatarUpdateCalls[0];
      expect(storedValue).toMatch(/^\/api\/v3\/avatar\/7\?v=\d+$/);
      expect(userId).toBe(7);
    });

    // There is no serverless data-URL fallback anymore: avatars always go
    // into the database, so setting VERCEL changes nothing.
    it("stores the avatar in the database regardless of environment (no data-URL fallback)", async () => {
      process.env.VERCEL = "1";
      try {
        logIn();
        const res = await PATCH(
          updateRequest({
            avatarUrl: pngDataUrl,
            currentPassword: CURRENT_PASSWORD,
          }),
        );
        expect(res.status).toBe(200);
        expect(avatarStoreCalls).toHaveLength(1);
        const [storedValue] = avatarUpdateCalls[0];
        expect(storedValue).toMatch(/^\/api\/v3\/avatar\/7\?v=\d+$/);
        // The raw data URL is never what gets stored in the column now.
        expect(storedValue).not.toBe(pngDataUrl);
      } finally {
        delete process.env.VERCEL;
      }
    });
  });

  describe("password", () => {
    it("rejects a password shorter than the minimum length", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          newPassword: "Short1!",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/password needs/i);
      expect(passwordUpdateCalls).toHaveLength(0);
    });

    // Fixed: the password branch now calls checkPasswordRequirements(), the
    // same hard gate signup/route.ts and reset-password/route.ts already
    // enforce (12+ chars, case/digit/symbol, not built from the account's
    // own email/name), closing the gap the earlier version of this test
    // documented.
    it("rejects an 8-character password with no complexity at all", async () => {
      logIn();
      const weakPassword = "aaaaaaaa"; // 8 lowercase letters, no digit/symbol/uppercase

      const res = await PATCH(
        updateRequest({
          newPassword: weakPassword,
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      // Rejected by either the advisory strength gate ("too weak") or the
      // hard-requirements gate ("password needs") -- a low-entropy string
      // trips the strength gate first now that it runs before the hard checks.
      expect(json.error).toMatch(/too weak|password needs/i);
      expect(passwordUpdateCalls).toHaveLength(0);
    });

    it("invalidates all other sessions and issues a fresh one on a successful password change", async () => {
      logIn(7);
      const newPassword = "Another-Strong-Password-9!";

      const res = await PATCH(
        updateRequest({ newPassword, currentPassword: CURRENT_PASSWORD }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.sessionInvalidated).toBe(true);
      expect(sessionDeleteCalls).toEqual([[7]]);
      expect(sessionInsertCalls).toHaveLength(1);
      expect(sessionInsertCalls[0][1]).toBe(7);

      // A fresh session cookie is set on the response.
      const setCookie = res.headers.get("set-cookie") || "";
      expect(setCookie).toContain(AUTH_SESSION_COOKIE_NAME);
    }, 15_000);

    it("invalidates any outstanding password-reset link", async () => {
      // Those rows reference no password hash, so changing the password did
      // not invalidate them and an unclicked emailed link stayed live. The
      // realistic path is the one the surrounding code is written for: a user
      // rotates their password BECAUSE they suspect compromise, and the link
      // sitting in their mailbox resets it again. Every other path that needs
      // to already clears them.
      logIn();
      await PATCH(
        updateRequest({
          newPassword: "A-strong-new-passphrase-42!",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(
        queries.some(
          (q) =>
            q.sql.startsWith("DELETE FROM password_reset_tokens") &&
            q.params[0] === 7,
        ),
      ).toBe(true);
    });

    it("sends a password-changed notification in the background", async () => {
      logIn();
      await PATCH(
        updateRequest({
          newPassword: "Another-Strong-Password-9!",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    }, 15_000);
  });

  it("returns the current profile unchanged when no fields are sent", async () => {
    logIn();
    const res = await PATCH(updateRequest({}));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/updated successfully/i);
    expect(nameUpdateCalls).toHaveLength(0);
    expect(emailUpdateCalls).toHaveLength(0);
    expect(avatarUpdateCalls).toHaveLength(0);
    expect(passwordUpdateCalls).toHaveLength(0);
  });
});
