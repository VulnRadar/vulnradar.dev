import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/discord/callback.
 *
 * Mocked at the network/database boundary only: the pg pool, and the
 * outbound fetch calls to discord.com (real network I/O). getSession,
 * createSession, verifyDiscordState/signDiscordState, encryptApiKey/
 * decryptApiKey, and findTrustedDevice all run for real.
 *
 * The key requirement this suite exists to prove: a tampered OAuth state
 * value is rejected by the real HMAC verification in
 * lib/auth/discord-state.ts, not silently accepted.
 */

process.env.DISCORD_CLIENT_ID = "test-discord-client-id";
process.env.DISCORD_CLIENT_SECRET = "test-discord-client-secret";
process.env.API_KEY_ENCRYPTION_KEY = "e".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];
let sessionRow: Record<string, unknown> | null = null;
let existingConnectionUserId: number | null = null;
let twoFAConfigRow: {
  totp_enabled: boolean;
  two_factor_method: string;
  email: string;
} | null = null;
let trustedDeviceRow: Record<string, unknown> | null = null;

let connectionUpsertCalls: unknown[][] = [];
let discordIdUpdateCalls: unknown[][] = [];
let tokenUpdateCalls: unknown[][] = [];
let sessionInsertCalls: unknown[][] = [];
let emailCodeInsertCalls: unknown[][] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (
    s.startsWith(
      "SELECT user_id FROM discord_connections WHERE discord_id = $1",
    )
  ) {
    return {
      rows:
        existingConnectionUserId != null
          ? [{ user_id: existingConnectionUserId }]
          : [],
    };
  }
  if (s.startsWith("INSERT INTO discord_connections")) {
    connectionUpsertCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET discord_id = $1")) {
    discordIdUpdateCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE discord_connections SET")) {
    tokenUpdateCalls.push(params);
    return { rows: [] };
  }
  // The column list grew a `role` (the PAUSE_LOGINS gate needs it and this
  // path already had to read the row), so match on the stable prefix rather
  // than the whole projection.
  if (s.startsWith("SELECT totp_enabled, two_factor_method, email")) {
    return { rows: twoFAConfigRow ? [twoFAConfigRow] : [] };
  }
  if (s.startsWith("SELECT 1 FROM device_trust")) {
    return { rows: trustedDeviceRow ? [trustedDeviceRow] : [] };
  }
  if (s.startsWith("UPDATE device_trust SET last_used_at")) return { rows: [] };
  if (s.startsWith("INSERT INTO sessions")) {
    sessionInsertCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("DELETE FROM email_2fa_codes WHERE user_id"))
    return { rows: [] };
  if (s.startsWith("INSERT INTO email_2fa_codes")) {
    emailCodeInsertCalls.push(params);
    return { rows: [] };
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

let tokenExchangeOk = true;
let userFetchOk = true;
let discordUserFixture = {
  id: "999888777",
  username: "TestDiscordUser",
  discriminator: "0",
  avatar: "avatarhash123",
  email: "discord-owner@example.com",
  verified: true,
};

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "https://discord.com/api/oauth2/token") {
    if (!tokenExchangeOk) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    }
    return new Response(
      JSON.stringify({
        access_token: "fake-access-token",
        token_type: "Bearer",
        expires_in: 604800,
        refresh_token: "fake-refresh-token",
        scope: "identify email guilds.join",
      }),
      { status: 200 },
    );
  }
  if (url === "https://discord.com/api/users/@me") {
    if (!userFetchOk) return new Response("unauthorized", { status: 401 });
    return new Response(JSON.stringify(discordUserFixture), { status: 200 });
  }
  return new Response(null, { status: 404 });
});
vi.stubGlobal("fetch", mockFetch);

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME, DEVICE_TRUST_COOKIE_NAME } =
  await import("@/lib/config/constants");
const { signDiscordState, DISCORD_NONCE_COOKIE } =
  await import("@/lib/auth/discord-state");
const { decryptApiKey } = await import("@/lib/auth/crypto");
const { verifyPendingToken } = await import("@/lib/auth/pending-2fa");
const { GET } = await import("@/app/api/v3/auth/discord/callback/route");

function callbackRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/v3/auth/discord/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: { "user-agent": "vitest-agent" },
  });
}

function locationOf(res: Response): URL {
  return new URL(res.headers.get("location") || "http://localhost/");
}

/**
 * A sign-in state is only usable in the browser that STARTED the flow: the
 * start route mints a nonce, signs it into the state, and drops it in the
 * httpOnly DISCORD_NONCE_COOKIE. Mint both halves together the way the real
 * flow does. Without the cookie the callback rejects the state, which is the
 * login-CSRF / session-fixation fix (see the nonce block in the callback).
 */
function loginState(nonce = "test-discord-nonce"): string {
  cookieState.set(DISCORD_NONCE_COOKIE, nonce);
  return signDiscordState({ action: "login", nonce });
}

beforeEach(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  mockQuery.mockClear();
  mockFetch.mockClear();
  mockSendEmail.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  headerState.set("user-agent", "vitest-agent");
  sessionRow = null;
  existingConnectionUserId = null;
  twoFAConfigRow = null;
  trustedDeviceRow = null;
  connectionUpsertCalls = [];
  discordIdUpdateCalls = [];
  tokenUpdateCalls = [];
  sessionInsertCalls = [];
  emailCodeInsertCalls = [];
  tokenExchangeOk = true;
  userFetchOk = true;
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/discord/callback", () => {
  it("redirects with discord_denied when Discord reports an error", async () => {
    const res = await GET(callbackRequest({ error: "access_denied" }));
    expect(locationOf(res).searchParams.get("error")).toBe("discord_denied");
  });

  it("redirects with discord_invalid when code or state is missing", async () => {
    const res = await GET(callbackRequest({ code: "abc" })); // no state
    expect(locationOf(res).searchParams.get("error")).toBe("discord_invalid");
  });

  it("rejects a tampered state (HMAC verification) instead of trusting it", async () => {
    const validState = signDiscordState({ action: "login" });
    // Flip one character in the signature half of the state so the HMAC no
    // longer matches the payload -- this is exactly what an attacker who
    // captured a state value and tried to alter it (e.g. to change the
    // bound action or userId) would produce.
    const dot = validState.lastIndexOf(".");
    const sig = validState.slice(dot + 1);
    const tamperedChar = sig[0] === "A" ? "B" : "A";
    const tamperedState =
      validState.slice(0, dot + 1) + tamperedChar + sig.slice(1);

    const res = await GET(
      callbackRequest({ code: "somecode", state: tamperedState }),
    );

    expect(locationOf(res).searchParams.get("error")).toBe(
      "discord_invalid_state",
    );
    // No token exchange, no session, no connection -- rejected before any
    // Discord API call or database write.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(sessionInsertCalls).toHaveLength(0);
    expect(connectionUpsertCalls).toHaveLength(0);
  });

  it("rejects a state payload with the payload itself tampered (action swapped)", async () => {
    const validState = signDiscordState({ action: "login" });
    const dot = validState.lastIndexOf(".");
    const json = validState.slice(0, dot);
    const sig = validState.slice(dot + 1);
    const payload = JSON.parse(Buffer.from(json, "base64url").toString());
    payload.action = "connect"; // attacker tries to escalate "login" into "connect"
    const forgedJson = Buffer.from(JSON.stringify(payload)).toString(
      "base64url",
    );
    const forgedState = `${forgedJson}.${sig}`; // reuse the OLD signature, now stale

    const res = await GET(
      callbackRequest({ code: "somecode", state: forgedState }),
    );

    expect(locationOf(res).searchParams.get("error")).toBe(
      "discord_invalid_state",
    );
  });

  it("rejects an expired state", async () => {
    const expiredState = signDiscordState({
      action: "login",
      ts: Date.now() - 5 * 60 * 1000,
    });
    const res = await GET(
      callbackRequest({ code: "somecode", state: expiredState }),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("discord_expired");
  });

  it("rejects a state bound to a different signed-in user than the current session", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 42 });
    const state = signDiscordState({ action: "connect", userId: 999 }); // different user

    const res = await GET(callbackRequest({ code: "somecode", state }));

    expect(locationOf(res).searchParams.get("error")).toBe(
      "discord_invalid_state",
    );
  });

  it("redirects with discord_token_failed when the token exchange fails", async () => {
    tokenExchangeOk = false;
    const state = loginState();

    const res = await GET(callbackRequest({ code: "somecode", state }));

    expect(locationOf(res).searchParams.get("error")).toBe(
      "discord_token_failed",
    );
  });

  it("redirects with discord_user_failed when fetching the Discord user fails", async () => {
    userFetchOk = false;
    const state = loginState();

    const res = await GET(callbackRequest({ code: "somecode", state }));

    expect(locationOf(res).searchParams.get("error")).toBe(
      "discord_user_failed",
    );
  });

  it("redirects with discord_failed when an unexpected error is thrown", async () => {
    mockFetch.mockImplementationOnce(async () => {
      throw new Error("network blip");
    });
    const state = loginState();

    const res = await GET(callbackRequest({ code: "somecode", state }));

    expect(locationOf(res).searchParams.get("error")).toBe("discord_failed");
  });

  describe("action=connect", () => {
    it("redirects with session_expired when there is no active session at callback time", async () => {
      const state = signDiscordState({ action: "connect" });
      const res = await GET(callbackRequest({ code: "somecode", state }));
      expect(locationOf(res).searchParams.get("error")).toBe("session_expired");
    });

    it("rejects linking a Discord account already linked to a different user", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 42 });
      existingConnectionUserId = 7; // linked to someone else
      const state = signDiscordState({ action: "connect", userId: 42 });

      const res = await GET(callbackRequest({ code: "somecode", state }));

      const location = locationOf(res);
      expect(location.pathname).toBe("/profile");
      expect(location.searchParams.get("error")).toBe("discord_already_linked");
      expect(connectionUpsertCalls).toHaveLength(0);
    });

    it("links the Discord account, encrypts the tokens at rest, and never leaks the Discord email into the redirect URL", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 42 });
      existingConnectionUserId = null;
      const state = signDiscordState({ action: "connect", userId: 42 });

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(connectionUpsertCalls).toHaveLength(1);
      const params = connectionUpsertCalls[0];
      expect(params[0]).toBe(42); // user_id
      expect(params[1]).toBe(discordUserFixture.id);
      // access_token / refresh_token params are encrypted, not raw.
      const encryptedAccessToken = params[6] as string;
      const encryptedRefreshToken = params[7] as string;
      expect(encryptedAccessToken).not.toBe("fake-access-token");
      expect(decryptApiKey(encryptedAccessToken)).toBe("fake-access-token");
      expect(decryptApiKey(encryptedRefreshToken)).toBe("fake-refresh-token");

      expect(discordIdUpdateCalls).toEqual([[discordUserFixture.id, 42]]);

      const location = locationOf(res);
      expect(location.pathname).toBe("/profile");
      expect(location.searchParams.get("discord_connected")).toBe("true");
      expect(location.searchParams.get("discord_username")).toBe(
        discordUserFixture.username,
      );
      // Privacy: the Discord email must never appear in the redirect URL.
      expect(location.search).not.toContain(discordUserFixture.email);
      expect(location.searchParams.has("discord_email")).toBe(false);
    });
  });

  describe("action=login browser binding (login CSRF / session fixation)", () => {
    it("rejects a captured sign-in state replayed into a browser that never started the flow", async () => {
      // The attack: attacker starts action=login while signed out, approves at
      // Discord, captures the callback URL without following it, and lures a
      // victim to it inside the state's TTL. The HMAC verifies (the server
      // minted it) and the login branch resolves the ATTACKER's account, so
      // createSession would silently replace the victim's own session. The
      // victim's browser never received the nonce cookie, so this must fail.
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: false,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = signDiscordState({
        action: "login",
        nonce: "attacker-nonce",
      });
      // No DISCORD_NONCE_COOKIE in this browser.

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(locationOf(res).searchParams.get("error")).toBe(
        "discord_invalid_state",
      );
      expect(sessionInsertCalls).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects a sign-in state whose nonce does not match this browser's cookie", async () => {
      existingConnectionUserId = 42;
      cookieState.set(DISCORD_NONCE_COOKIE, "some-other-browsers-nonce");
      const state = signDiscordState({
        action: "login",
        nonce: "attacker-nonce",
      });

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(locationOf(res).searchParams.get("error")).toBe(
        "discord_invalid_state",
      );
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("clears the nonce cookie so a sign-in state cannot be replayed twice", async () => {
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: false,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = loginState();

      await GET(callbackRequest({ code: "somecode", state }));

      expect(cookieState.get(DISCORD_NONCE_COOKIE)).toBeUndefined();
    });

    it("still binds action=connect by session userId, with no nonce cookie required", async () => {
      // The connect flow carries a real userId in the signed state, so it is
      // already bound to the session and must keep working unchanged.
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 42 });
      existingConnectionUserId = null;
      const state = signDiscordState({ action: "connect", userId: 42 });

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(connectionUpsertCalls).toHaveLength(1);
      expect(locationOf(res).pathname).toBe("/profile");
    });
  });

  describe("action=login", () => {
    it("redirects with discord_not_linked when no account is linked to this Discord id", async () => {
      existingConnectionUserId = null;
      const state = loginState();

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(locationOf(res).searchParams.get("error")).toBe(
        "discord_not_linked",
      );
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("creates a real session and redirects to the dashboard when the linked account has no 2FA", async () => {
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: false,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = loginState();

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(sessionInsertCalls).toHaveLength(1);
      expect(sessionInsertCalls[0][1]).toBe(42);
      expect(locationOf(res).pathname).toBe("/dashboard");
    });

    it("routes a 2FA-enabled account to the pending-2FA cookie instead of a session, for an untrusted device", async () => {
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: true,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = loginState();

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(sessionInsertCalls).toHaveLength(0);
      const location = locationOf(res);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("discord_2fa")).toBe("pending");
      expect(location.searchParams.get("method")).toBe("app");
      expect(cookieState.get("discord_pending_login")).toBeTruthy();
      // The pending cookie is a signed token now, not raw JSON.
      const pending = verifyPendingToken<{ userId: number }>(
        cookieState.get("discord_pending_login")!,
      );
      expect(pending?.userId).toBe(42);
    });

    it("sends the email 2FA code in the background for email-method 2FA", async () => {
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: true,
        two_factor_method: "email",
        email: "u@example.com",
      };
      const state = loginState();

      await GET(callbackRequest({ code: "somecode", state }));
      await new Promise((resolve) => setImmediate(resolve));

      expect(emailCodeInsertCalls).toHaveLength(1);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("skips 2FA and creates a session directly for a trusted device", async () => {
      existingConnectionUserId = 42;
      twoFAConfigRow = {
        totp_enabled: true,
        two_factor_method: "app",
        email: "u@example.com",
      };
      trustedDeviceRow = { "?column?": 1 };
      cookieState.set(DEVICE_TRUST_COOKIE_NAME, "f".repeat(64));
      const state = loginState();

      const res = await GET(callbackRequest({ code: "somecode", state }));

      expect(sessionInsertCalls).toHaveLength(1);
      expect(locationOf(res).pathname).toBe("/dashboard");
    });
  });

  describe("when Discord OAuth isn't configured", () => {
    const originalId = process.env.DISCORD_CLIENT_ID;
    const originalSecret = process.env.DISCORD_CLIENT_SECRET;

    afterEach(() => {
      process.env.DISCORD_CLIENT_ID = originalId;
      process.env.DISCORD_CLIENT_SECRET = originalSecret;
      vi.resetModules();
    });

    it("redirects with discord_not_configured when the client id/secret aren't set", async () => {
      delete process.env.DISCORD_CLIENT_ID;
      delete process.env.DISCORD_CLIENT_SECRET;
      vi.resetModules();
      const { GET: unconfiguredGET } =
        await import("@/app/api/v3/auth/discord/callback/route");
      const state = loginState();

      const res = await unconfiguredGET(
        callbackRequest({ code: "somecode", state }),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "discord_not_configured",
      );
    });
  });
});
