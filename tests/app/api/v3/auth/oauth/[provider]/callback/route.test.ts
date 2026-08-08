import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/oauth/[provider]/callback -- the
 * new sign-up/sign-in flow, distinct from the existing Discord
 * account-linking callback (app/api/v3/auth/discord/callback/route.ts),
 * which has its own test suite and is untouched by this feature.
 *
 * Mocked at the network/database boundary only: the pg pool, next/headers,
 * outbound email, and global fetch (the provider's token + userinfo
 * endpoints). verifyOAuthState, createOAuthUser, createSession, and
 * findTrustedDevice all run for real against the mocked pool.
 *
 * The core behavior this suite exists to prove: the email-collision rules
 * (create on first sight, reject a different provider/password owner,
 * log in normally for the same provider) and that a tampered/expired
 * state is rejected before any provider API call or database write.
 */

process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.API_KEY_ENCRYPTION_KEY = "f".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];
let userByEmailRow: {
  id: number;
  auth_provider: string | null;
  disabled_at: string | null;
} | null = null;
let twoFARow: {
  totp_enabled: boolean;
  two_factor_method: string;
  email: string;
} | null = null;
let trustedDeviceRow: Record<string, unknown> | null = null;

let insertUserCalls: unknown[][] = [];
let notifPrefsInsertCalls: unknown[][] = [];
let avatarUpdateCalls: unknown[][] = [];
let sessionInsertCalls: unknown[][] = [];
let emailCodeInsertCalls: unknown[][] = [];

// Account-linking (?purpose=link / handleOAuthLink) fixtures.
let linkSessionRow: Record<string, unknown> | null = null;
let existingGoogleIdRow: { id: number } | null = null;
let googleLinkUpdateCalls: unknown[][] = [];
let googleLinkUpdateThrowsUniqueViolation = false;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });

  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (
    s.startsWith("SELECT id, auth_provider, disabled_at FROM users WHERE email")
  ) {
    return { rows: userByEmailRow ? [userByEmailRow] : [] };
  }
  if (s.startsWith("INSERT INTO users")) {
    // createOAuthUser's INSERT ... RETURNING
    insertUserCalls.push(params);
    return {
      rows: [
        {
          id: 900,
          email: params[0],
          name: params[1],
          plan: "free",
          beta_access: false,
          role: "user",
        },
      ],
    };
  }
  if (s.startsWith("INSERT INTO notification_preferences")) {
    notifPrefsInsertCalls.push(params);
    return { rows: [] };
  }
  if (s.startsWith("UPDATE users SET avatar_url")) {
    avatarUpdateCalls.push(params);
    return { rows: [] };
  }
  if (
    s.startsWith(
      "SELECT totp_enabled, two_factor_method, email FROM users WHERE id",
    )
  ) {
    return { rows: twoFARow ? [twoFARow] : [] };
  }
  if (s.startsWith("SELECT 1 FROM device_trust")) {
    return { rows: trustedDeviceRow ? [trustedDeviceRow] : [] };
  }
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
  if (s.includes("SELECT s.user_id")) {
    return { rows: linkSessionRow ? [linkSessionRow] : [] };
  }
  if (s.startsWith("SELECT id FROM users WHERE google_id")) {
    return { rows: existingGoogleIdRow ? [existingGoogleIdRow] : [] };
  }
  if (s.startsWith("UPDATE users SET google_id")) {
    if (googleLinkUpdateThrowsUniqueViolation) {
      const err = new Error("duplicate key value violates unique constraint");
      (err as unknown as { code: string }).code = "23505";
      throw err;
    }
    googleLinkUpdateCalls.push(params);
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
let googleUserFixture: {
  sub?: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture: string;
} = {
  sub: "google-sub-1",
  email: "owner@example.com",
  email_verified: true,
  name: "Test Owner",
  picture: "https://example.com/avatar.png",
};

const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input.toString();
  if (url === "https://oauth2.googleapis.com/token") {
    if (!tokenExchangeOk) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      });
    }
    return new Response(JSON.stringify({ access_token: "fake-access-token" }), {
      status: 200,
    });
  }
  if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
    if (!userFetchOk) return new Response("unauthorized", { status: 401 });
    return new Response(JSON.stringify(googleUserFixture), { status: 200 });
  }
  return new Response(null, { status: 404 });
});
vi.stubGlobal("fetch", mockFetch);

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { DEVICE_TRUST_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME } = await import(
  "@/lib/config/constants"
);
const { signOAuthState } = await import("@/lib/auth/oauth-state");
const { GET } =
  await import("@/app/api/v3/auth/oauth/[provider]/callback/route");

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function callbackRequest(
  provider: string,
  params: Record<string, string>,
): Request {
  const url = new URL(
    `http://localhost/api/v3/auth/oauth/${provider}/callback`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), {
    headers: { "user-agent": "vitest-agent" },
  });
}

function locationOf(res: Response): URL {
  return new URL(res.headers.get("location") || "http://localhost/");
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
  userByEmailRow = null;
  twoFARow = null;
  trustedDeviceRow = null;
  insertUserCalls = [];
  notifPrefsInsertCalls = [];
  avatarUpdateCalls = [];
  sessionInsertCalls = [];
  emailCodeInsertCalls = [];
  tokenExchangeOk = true;
  userFetchOk = true;
  linkSessionRow = null;
  existingGoogleIdRow = null;
  googleLinkUpdateCalls = [];
  googleLinkUpdateThrowsUniqueViolation = false;
  googleUserFixture = {
    sub: "google-sub-1",
    email: "owner@example.com",
    email_verified: true,
    name: "Test Owner",
    picture: "https://example.com/avatar.png",
  };
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/oauth/[provider]/callback", () => {
  it("redirects with oauth_invalid for an unknown provider", async () => {
    const res = await GET(
      callbackRequest("facebook", { code: "x", state: "y" }),
      ctx("facebook"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_invalid");
  });

  it("redirects with oauth_denied when the provider reports an error", async () => {
    const res = await GET(
      callbackRequest("google", { error: "access_denied" }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_denied");
  });

  it("redirects with oauth_invalid when code or state is missing", async () => {
    const res = await GET(
      callbackRequest("google", { code: "abc" }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_invalid");
  });

  it("redirects with oauth_not_configured when the provider has no client id/secret", async () => {
    const state = signOAuthState("github");
    const res = await GET(
      callbackRequest("github", { code: "somecode", state }),
      ctx("github"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe(
      "oauth_not_configured",
    );
  });

  it("rejects a tampered state instead of trusting it", async () => {
    const validState = signOAuthState("google");
    const dot = validState.lastIndexOf(".");
    const sig = validState.slice(dot + 1);
    const tamperedChar = sig[0] === "A" ? "B" : "A";
    const tamperedState =
      validState.slice(0, dot + 1) + tamperedChar + sig.slice(1);

    const res = await GET(
      callbackRequest("google", { code: "somecode", state: tamperedState }),
      ctx("google"),
    );

    expect(locationOf(res).searchParams.get("error")).toBe(
      "oauth_invalid_state",
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(sessionInsertCalls).toHaveLength(0);
    expect(insertUserCalls).toHaveLength(0);
  });

  it("rejects a state signed for a different provider than the callback path", async () => {
    const state = signOAuthState("github");
    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe(
      "oauth_invalid_state",
    );
  });

  it("rejects an expired state", async () => {
    // signOAuthState always stamps "now", so build one manually far in the past.
    const { createHmac } = await import("node:crypto");
    const payload = JSON.stringify({
      nonce: "n",
      provider: "google",
      ts: Date.now() - 10 * 60 * 1000,
    });
    const json = Buffer.from(payload).toString("base64url");
    const sig = createHmac("sha256", process.env.API_KEY_ENCRYPTION_KEY!)
      .update(json)
      .digest("base64url");
    const state = `${json}.${sig}`;

    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_expired");
  });

  it("redirects with oauth_token_failed when the token exchange fails", async () => {
    tokenExchangeOk = false;
    const state = signOAuthState("google");
    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe(
      "oauth_token_failed",
    );
  });

  it("redirects with oauth_user_failed when the userinfo fetch fails", async () => {
    userFetchOk = false;
    const state = signOAuthState("google");
    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_user_failed");
  });

  it("redirects with oauth_email_unverified when the provider's email isn't verified", async () => {
    googleUserFixture = { ...googleUserFixture, email_verified: false };
    const state = signOAuthState("google");
    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe(
      "oauth_email_unverified",
    );
    googleUserFixture = { ...googleUserFixture, email_verified: true };
  });

  it("redirects with oauth_failed when an unexpected error is thrown", async () => {
    // A network blip during the token/userinfo fetch is handled gracefully
    // by lib/auth/oauth-userinfo.ts itself (logged, returns null), which
    // the route turns into oauth_token_failed/oauth_user_failed -- see the
    // dedicated tests above. This case exercises the route's own outer
    // try/catch for something that isn't already handled that way, e.g. an
    // unexpected database error while looking up the user by email.
    mockQuery.mockImplementationOnce(async () => {
      throw new Error("db blip");
    });
    const state = signOAuthState("google");
    const res = await GET(
      callbackRequest("google", { code: "somecode", state }),
      ctx("google"),
    );
    expect(locationOf(res).searchParams.get("error")).toBe("oauth_failed");
  });

  describe("no account with this email", () => {
    it("creates a new account, marks it 'google', seeds notification prefs, sets the avatar, and logs in", async () => {
      userByEmailRow = null;
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(insertUserCalls).toHaveLength(1);
      expect(insertUserCalls[0]).toEqual([
        googleUserFixture.email,
        googleUserFixture.name,
        "google",
      ]);
      expect(locationOf(res).pathname).toBe("/dashboard");
      expect(sessionInsertCalls).toHaveLength(1);
      expect(sessionInsertCalls[0][1]).toBe(900);
      expect(notifPrefsInsertCalls).toEqual([[900]]);
      expect(avatarUpdateCalls).toEqual([[googleUserFixture.picture, 900]]);
    });
  });

  describe("an account already exists with this email", () => {
    it("rejects with oauth_email_in_use when it was created by password signup", async () => {
      userByEmailRow = { id: 42, auth_provider: "password", disabled_at: null };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      const location = locationOf(res);
      expect(location.searchParams.get("error")).toBe("oauth_email_in_use");
      expect(
        decodeURIComponent(location.searchParams.get("message") || ""),
      ).toContain("Sign in with your password instead");
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("rejects with oauth_email_in_use and names the other provider when it was created by GitHub", async () => {
      userByEmailRow = { id: 42, auth_provider: "github", disabled_at: null };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      const location = locationOf(res);
      expect(location.searchParams.get("error")).toBe("oauth_email_in_use");
      expect(
        decodeURIComponent(location.searchParams.get("message") || ""),
      ).toContain("Sign in with GitHub instead");
    });

    it("rejects with oauth_email_in_use for a legacy row with no auth_provider (treated as password)", async () => {
      userByEmailRow = { id: 42, auth_provider: null, disabled_at: null };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      const location = locationOf(res);
      expect(location.searchParams.get("error")).toBe("oauth_email_in_use");
      expect(
        decodeURIComponent(location.searchParams.get("message") || ""),
      ).toContain("Sign in with your password instead");
    });

    it("rejects with oauth_account_disabled for a suspended account owned by the same provider", async () => {
      userByEmailRow = {
        id: 42,
        auth_provider: "google",
        disabled_at: new Date().toISOString(),
      };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_account_disabled",
      );
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("logs in directly when the same provider created the account and it has no 2FA", async () => {
      userByEmailRow = { id: 42, auth_provider: "google", disabled_at: null };
      twoFARow = {
        totp_enabled: false,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(sessionInsertCalls).toHaveLength(1);
      expect(sessionInsertCalls[0][1]).toBe(42);
      expect(locationOf(res).pathname).toBe("/dashboard");
      // No new account or notification-prefs row for a returning user.
      expect(notifPrefsInsertCalls).toHaveLength(0);
    });

    it("requires 2FA (untrusted device) instead of creating a session directly", async () => {
      userByEmailRow = { id: 42, auth_provider: "google", disabled_at: null };
      twoFARow = {
        totp_enabled: true,
        two_factor_method: "app",
        email: "u@example.com",
      };
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(sessionInsertCalls).toHaveLength(0);
      const location = locationOf(res);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("oauth_2fa")).toBe("pending");
      expect(location.searchParams.get("method")).toBe("app");
      expect(cookieState.get("oauth_pending_login")).toBeTruthy();
      const pending = JSON.parse(cookieState.get("oauth_pending_login")!);
      expect(pending.userId).toBe(42);
    });

    it("sends the email 2FA code in the background for email-method 2FA", async () => {
      userByEmailRow = { id: 42, auth_provider: "google", disabled_at: null };
      twoFARow = {
        totp_enabled: true,
        two_factor_method: "email",
        email: "u@example.com",
      };
      const state = signOAuthState("google");

      await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(emailCodeInsertCalls).toHaveLength(1);
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("skips 2FA and creates a session directly for a trusted device", async () => {
      userByEmailRow = { id: 42, auth_provider: "google", disabled_at: null };
      twoFARow = {
        totp_enabled: true,
        two_factor_method: "app",
        email: "u@example.com",
      };
      trustedDeviceRow = { "?column?": 1 };
      cookieState.set(DEVICE_TRUST_COOKIE_NAME, "e".repeat(64));
      const state = signOAuthState("google");

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(sessionInsertCalls).toHaveLength(1);
      expect(locationOf(res).pathname).toBe("/dashboard");
    });
  });

  describe("account linking (purpose: link)", () => {
    it("redirects with oauth_session_expired when there's no session", async () => {
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      const location = locationOf(res);
      expect(location.pathname).toBe("/profile");
      expect(location.searchParams.get("tab")).toBe("social");
      expect(location.searchParams.get("error")).toBe("oauth_session_expired");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("redirects with oauth_session_expired when the current session is a different user", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 999 });
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_session_expired",
      );
      expect(googleLinkUpdateCalls).toHaveLength(0);
    });

    it("links the identity onto the session's account and redirects with google_connected=true", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(googleLinkUpdateCalls).toEqual([
        [
          "google-sub-1",
          googleUserFixture.email,
          googleUserFixture.name,
          googleUserFixture.picture,
          7,
        ],
      ]);
      const location = locationOf(res);
      expect(location.pathname).toBe("/profile");
      expect(location.searchParams.get("tab")).toBe("social");
      expect(location.searchParams.get("google_connected")).toBe("true");
      // The sign-up/sign-in path's account-creation queries must never run
      // for a link.
      expect(insertUserCalls).toHaveLength(0);
      expect(sessionInsertCalls).toHaveLength(0);
    });

    it("rejects with oauth_already_linked when the identity already belongs to a different account", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      existingGoogleIdRow = { id: 999 };
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      const location = locationOf(res);
      expect(location.searchParams.get("error")).toBe("oauth_already_linked");
      expect(
        decodeURIComponent(location.searchParams.get("message") || ""),
      ).toContain("already connected to a different VulnRadar account");
      expect(googleLinkUpdateCalls).toHaveLength(0);
    });

    it("allows re-linking an identity already connected to the SAME account", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      existingGoogleIdRow = { id: 7 };
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(googleLinkUpdateCalls).toHaveLength(1);
      expect(locationOf(res).searchParams.get("google_connected")).toBe(
        "true",
      );
    });

    it("turns a unique-constraint race into oauth_already_linked instead of a raw failure", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      googleLinkUpdateThrowsUniqueViolation = true;
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_already_linked",
      );
    });

    it("redirects with oauth_user_failed when the provider response has no stable id", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      googleUserFixture = { ...googleUserFixture, sub: undefined };
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_user_failed",
      );
    });

    it("redirects with oauth_email_unverified when the provider's email isn't verified", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      googleUserFixture = { ...googleUserFixture, email_verified: false };
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_email_unverified",
      );
    });

    it("redirects with oauth_token_failed when the token exchange fails", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      tokenExchangeOk = false;
      const state = signOAuthState("google", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("google", { code: "somecode", state }),
        ctx("google"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe(
        "oauth_token_failed",
      );
    });

    it("refuses to link discord even if a caller forges a link-purpose discord state", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      linkSessionRow = defaultSessionRow({ user_id: 7 });
      process.env.DISCORD_CLIENT_ID = "discord-client-id";
      process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
      const state = signOAuthState("discord", { purpose: "link", userId: 7 });

      const res = await GET(
        callbackRequest("discord", { code: "somecode", state }),
        ctx("discord"),
      );

      expect(locationOf(res).searchParams.get("error")).toBe("oauth_invalid");
      delete process.env.DISCORD_CLIENT_ID;
      delete process.env.DISCORD_CLIENT_SECRET;
    });
  });
});
