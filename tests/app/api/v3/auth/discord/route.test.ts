import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for /api/v3/auth/discord (GET starts the Discord OAuth
 * sign-in, POST starts a connect once the password checks out).
 *
 * Mocked at the network/database boundary only: the pg pool. getSession()
 * and signDiscordState() (real HMAC signing, lib/auth/discord-state.ts) run
 * for real. DISCORD_CLIENT_ID is read at module import time by the route,
 * so it must be set in the environment before the route module is first
 * imported below.
 */

process.env.DISCORD_CLIENT_ID = "test-discord-client-id";
process.env.API_KEY_ENCRYPTION_KEY = "d".repeat(64);

const queries: { sql: string; params: unknown[] }[] = [];
let sessionRow: Record<string, unknown> | null = null;
// password_hash for the re-authentication lookup. undefined means no row.
let storedHash: string | null | undefined = undefined;
let rateLimitBucketFull = false;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
  if (s.startsWith("SELECT password_hash FROM users WHERE id = $1"))
    return {
      rows: storedHash === undefined ? [] : [{ password_hash: storedHash }],
    };
  // Zero rows from the limiter's upsert means the bucket is full.
  if (s.startsWith("INSERT INTO rate_limits"))
    return { rows: rateLimitBucketFull ? [] : [{ count: "1" }] };
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

const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");
const { AUTH_SESSION_COOKIE_NAME } = await import("@/lib/config/constants");
const { verifyDiscordState, DISCORD_NONCE_COOKIE } =
  await import("@/lib/auth/discord-state");
const { GET, POST } = await import("@/app/api/v3/auth/discord/route");
const { hashPassword } = await import("@/lib/auth/password-hash");

const CONNECT_PASSWORD = "the-account-password";
const connectPasswordHash = await hashPassword(CONNECT_PASSWORD);

function discordGet(action?: string) {
  const url = action
    ? `http://localhost/api/v3/auth/discord?action=${action}`
    : "http://localhost/api/v3/auth/discord";
  return new Request(url);
}

function discordPost(body?: unknown, action: string | null = "connect") {
  const url = action
    ? `http://localhost/api/v3/auth/discord?action=${action}`
    : "http://localhost/api/v3/auth/discord";
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function signedIn(overrides: Record<string, unknown> = {}) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow(overrides);
}

function stateIn(url: string) {
  return new URL(url).searchParams.get("state")!;
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  sessionRow = null;
  storedHash = undefined;
  rateLimitBucketFull = false;
  invalidateSettingsCache();
});

describe("/api/v3/auth/discord", () => {
  it("requires an existing session for action=connect", async () => {
    const res = await GET(discordGet("connect"));
    expect(res.status).toBe(401);
  });

  it("does not require a session for action=login", async () => {
    const res = await GET(discordGet("login"));
    expect(res.status).toBe(307); // NextResponse.redirect default
  });

  it("redirects to Discord's OAuth authorize endpoint with the expected query params", async () => {
    const loginRes = await GET(discordGet("login"));
    const location = loginRes.headers.get("location") || "";
    const url = new URL(location);

    expect(url.origin + url.pathname).toBe(
      "https://discord.com/api/oauth2/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("test-discord-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("identify email guilds.join");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toContain(
      "/api/v3/auth/discord/callback",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("signs a state that verifies and carries the requested action", async () => {
    const res = await GET(discordGet("login"));
    const url = new URL(res.headers.get("location") || "");
    const state = url.searchParams.get("state")!;

    const verified = verifyDiscordState(state);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.action).toBe("login");
      expect(verified.payload.userId).toBeUndefined();
    }
  });

  it("binds a connect state to the session's userId once the password checks out", async () => {
    signedIn({ user_id: 55 });
    storedHash = connectPasswordHash;

    const res = await POST(discordPost({ password: CONNECT_PASSWORD }));

    expect(res.status).toBe(200);
    const url: string = (await res.json()).url;
    expect(url).toContain("https://discord.com/api/oauth2/authorize");
    const state = stateIn(url);

    const verified = verifyDiscordState(state, 55);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload.userId).toBe(55);
      expect(verified.payload.action).toBe("connect");
    }
    // A different signed-in user's id must not verify against this state.
    const mismatched = verifyDiscordState(state, 999);
    expect(mismatched.ok).toBe(false);
  });

  it("sets an httpOnly nonce cookie for action=login and signs the same nonce into the state", async () => {
    // Browser binding for sign-in: without it a state minted by an attacker
    // can be replayed into a victim's browser to log the victim into the
    // attacker's account (login CSRF / session fixation).
    const res = await GET(discordGet("login"));
    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain(`${DISCORD_NONCE_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");

    const cookieNonce = decodeURIComponent(
      setCookie.split(`${DISCORD_NONCE_COOKIE}=`)[1].split(";")[0],
    );
    const state = new URL(res.headers.get("location") || "").searchParams.get(
      "state",
    )!;
    const verified = verifyDiscordState(state);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.nonce).toBe(cookieNonce);
  });

  it("sets no nonce cookie for action=connect, which is bound by session userId instead", async () => {
    signedIn({ user_id: 7 });
    storedHash = connectPasswordHash;

    const res = await POST(discordPost({ password: CONNECT_PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") || "").not.toContain(
      DISCORD_NONCE_COOKIE,
    );
  });

  it.each([
    ["action=connect", "connect"],
    ["a missing action, which means connect", undefined],
  ])(
    "cannot start %s from a navigation, which has no way to carry the password",
    async (_label, action) => {
      signedIn({ user_id: 7 });

      const res = await GET(discordGet(action));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Confirm your password first");
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("refuses a wrong password and signs no state", async () => {
    signedIn({ user_id: 7 });
    storedHash = connectPasswordHash;

    const res = await POST(discordPost({ password: "not-the-password" }));

    expect(res.status).toBe(403);
    expect((await res.json()).url).toBeUndefined();
  });

  it("asks for the password when the account has one and none was sent", async () => {
    signedIn({ user_id: 7 });
    storedHash = connectPasswordHash;

    const res = await POST(discordPost({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Confirm your password first");
  });

  it("takes a password-less account's empty post", async () => {
    signedIn({ user_id: 7 });
    storedHash = null;

    const res = await POST(discordPost());

    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("discord.com");
  });

  it("still treats a missing action as connect on the POST", async () => {
    signedIn({ user_id: 7 });
    storedHash = null;

    const res = await POST(discordPost({}, null));

    expect(res.status).toBe(200);
    const verified = verifyDiscordState(stateIn((await res.json()).url), 7);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.action).toBe("connect");
  });

  it("stops guessing the password once the attempt budget is spent", async () => {
    signedIn({ user_id: 7 });
    storedHash = connectPasswordHash;
    rateLimitBucketFull = true;

    const res = await POST(discordPost({ password: CONNECT_PASSWORD }));

    expect(res.status).toBe(429);
    expect(queries.some((q) => q.sql.includes("SELECT password_hash"))).toBe(
      false,
    );
  });

  it("requires a session on the POST", async () => {
    const res = await POST(discordPost({ password: CONNECT_PASSWORD }));
    expect(res.status).toBe(401);
  });

  it("has no POST for action=login", async () => {
    const res = await POST(discordPost({}, "login"));
    expect(res.status).toBe(400);
    expect((await res.json()).url).toBeUndefined();
  });

  // An impersonation session reaches this route as the customer. Connecting
  // the staff member's own Discord would leave a passwordless way into the
  // customer's account after impersonation ends.
  describe("through an impersonation session", () => {
    it("refuses the GET with 403 and signs no state", async () => {
      signedIn({ user_id: 5, impersonated_by: 1 });

      const res = await GET(discordGet("connect"));

      expect(res.status).toBe(403);
      expect((await res.json()).impersonationBlocked).toBe(true);
      expect(res.headers.get("location")).toBeNull();
    });

    it("refuses the POST with 403 before looking at any password", async () => {
      signedIn({ user_id: 5, impersonated_by: 1 });
      storedHash = connectPasswordHash;

      const res = await POST(discordPost({ password: CONNECT_PASSWORD }));

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.impersonationBlocked).toBe(true);
      expect(body.url).toBeUndefined();
      expect(queries.some((q) => q.sql.includes("SELECT password_hash"))).toBe(
        false,
      );
    });
  });

  // The callback refuses any action but connect and login, so a state signed
  // for anything else could never complete. The start route refuses it up
  // front instead of sending the visitor through Discord's consent screen
  // for nothing.
  it.each(["link", "Login", "connect ", "github-connect", "%00"])(
    "refuses action=%s with 400 and signs no state",
    async (action) => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });

      const res = await GET(discordGet(encodeURIComponent(action)));
      expect(res.status).toBe(400);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("set-cookie") || "").not.toContain(
        DISCORD_NONCE_COOKIE,
      );
    },
  );

  describe("when Discord isn't configured", () => {
    const original = process.env.DISCORD_CLIENT_ID;

    afterEach(() => {
      process.env.DISCORD_CLIENT_ID = original;
      vi.resetModules();
    });

    it("returns 500 when DISCORD_CLIENT_ID isn't set", async () => {
      delete process.env.DISCORD_CLIENT_ID;
      vi.resetModules();
      const { GET: unconfiguredGET } =
        await import("@/app/api/v3/auth/discord/route");

      const res = await unconfiguredGET(discordGet("login"));
      expect(res.status).toBe(500);
    });
  });
});
