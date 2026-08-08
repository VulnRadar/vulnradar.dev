import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/discord (start the Discord OAuth
 * flow).
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

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
  queries.push({ sql: s, params });
  if (s.startsWith("DELETE FROM sessions WHERE expires_at"))
    return { rows: [] };
  if (s.includes("SELECT s.user_id"))
    return { rows: sessionRow ? [sessionRow] : [] };
  if (s.startsWith("SELECT key, value FROM system_settings"))
    return { rows: [] };
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
const { verifyDiscordState } = await import("@/lib/auth/discord-state");
const { GET } = await import("@/app/api/v3/auth/discord/route");

function discordGet(action?: string) {
  const url = action
    ? `http://localhost/api/v3/auth/discord?action=${action}`
    : "http://localhost/api/v3/auth/discord";
  return new Request(url);
}

beforeEach(() => {
  mockQuery.mockClear();
  queries.length = 0;
  cookieState.clear();
  headerState.clear();
  sessionRow = null;
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/discord", () => {
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

  it("binds the state to the current session's userId when logged in", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 55 });

    const res = await GET(discordGet("connect"));
    const url = new URL(res.headers.get("location") || "");
    const state = url.searchParams.get("state")!;

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

  it("allows action=connect once a session is present", async () => {
    cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
    sessionRow = defaultSessionRow({ user_id: 7 });

    const res = await GET(discordGet("connect"));
    expect(res.status).toBe(307);
  });

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
