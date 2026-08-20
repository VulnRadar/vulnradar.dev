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
let passwordHashRow: { password_hash: string } | null = null;
let currentUserRow: { name: string; email: string } | null = null;
let existingEmailOwnerRow: { id: number } | null = null;
let updatedUserRow: Record<string, unknown> | null = null;

let nameUpdateCalls: unknown[][] = [];
let emailUpdateCalls: unknown[][] = [];
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
  if (s.startsWith("UPDATE rate_limits")) return { rows: [] };
  if (s.startsWith("INSERT INTO rate_limits")) {
    const key = params[0] as string;
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
  if (s.startsWith("SELECT id FROM users WHERE email = $1 AND id != $2")) {
    return { rows: existingEmailOwnerRow ? [existingEmailOwnerRow] : [] };
  }
  if (s.startsWith("UPDATE users SET email = $1, email_verified_at = NULL")) {
    emailUpdateCalls.push(params);
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
  avatarUpdateCalls = [];
  avatarStoreCalls = [];
  avatarDeleteCalls = [];
  passwordUpdateCalls = [];
  sessionDeleteCalls = [];
  sessionInsertCalls = [];
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

  it("rate limits repeated update attempts", async () => {
    logIn();
    rateLimitCounts.set("profile-update:7:unknown", 100); // RATE_LIMITS.api maxAttempts is well under 100

    const res = await PATCH(
      updateRequest({ name: "New Name", currentPassword: CURRENT_PASSWORD }),
    );
    expect(res.status).toBe(429);
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
    });

    it("updates the email, resets email_verified_at, and notifies both addresses", async () => {
      logIn();
      const res = await PATCH(
        updateRequest({
          email: "new-address@example.com",
          currentPassword: CURRENT_PASSWORD,
        }),
      );

      expect(res.status).toBe(200);
      expect(emailUpdateCalls).toHaveLength(1);
      const [newEmail, userId] = emailUpdateCalls[0];
      expect(newEmail).toBe("new-address@example.com");
      expect(userId).toBe(7);
      // email_verified_at is reset to NULL as a literal in the SQL text, not
      // a bound param -- verify via the query text captured for this call.
      const emailUpdateQuery = queries.find((q) =>
        q.sql.startsWith(
          "UPDATE users SET email = $1, email_verified_at = NULL",
        ),
      );
      expect(emailUpdateQuery?.sql).toContain("email_verified_at = NULL");

      await new Promise((resolve) => setImmediate(resolve));
      // One notification to the old address, one to the new address.
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });
  });

  describe("avatar", () => {
    const pngMagic = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const pngDataUrl = `data:image/png;base64,${Buffer.concat([pngMagic, Buffer.from("fake-rest-of-png")]).toString("base64")}`;

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

    it("allows a Discord CDN avatar URL without further validation", async () => {
      logIn();
      const discordUrl = "https://cdn.discordapp.com/avatars/123/abc.png";
      const res = await PATCH(
        updateRequest({
          avatarUrl: discordUrl,
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      expect(res.status).toBe(200);
      // The external URL is stored as-is (not moved into user_avatars)...
      expect(avatarUpdateCalls).toEqual([[discordUrl, 7]]);
      expect(avatarStoreCalls).toHaveLength(0);
    });

    it("deletes any stored avatar row when switching to a Discord CDN URL", async () => {
      logIn();
      await PATCH(
        updateRequest({
          avatarUrl: "https://cdn.discordapp.com/avatars/123/abc.png",
          currentPassword: CURRENT_PASSWORD,
        }),
      );
      // Switching to an external avatar drops any previously uploaded row.
      expect(avatarDeleteCalls).toContainEqual([7]);
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
      expect(json.error).toMatch(/password needs/i);
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
