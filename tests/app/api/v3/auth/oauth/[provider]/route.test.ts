import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for GET /api/v3/auth/oauth/[provider] (start the
 * OAuth sign-up/sign-in flow, and its `?action=link` account-linking
 * variant). The sign-in path never touches the database -- it only builds
 * a redirect URL -- but `?action=link` calls getSession(), so the pg pool
 * and next/headers are mocked here the same way
 * tests/app/api/v3/auth/discord/route.test.ts mocks them for the
 * equivalent Discord `?action=connect` check. getSession() itself runs for
 * real against the mocked pool.
 */

process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

let sessionRow: Record<string, unknown> | null = null;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
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
const { GET } = await import("@/app/api/v3/auth/oauth/[provider]/route");
const { verifyOAuthState } = await import("@/lib/auth/oauth-state");

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function oauthRequest(provider: string, query?: string): Request {
  const suffix = query ? `?${query}` : "";
  return new Request(`http://localhost/api/v3/auth/oauth/${provider}${suffix}`);
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  mockQuery.mockClear();
  cookieState.clear();
  headerState.clear();
  sessionRow = null;
  invalidateSettingsCache();
});

describe("GET /api/v3/auth/oauth/[provider]", () => {
  it("returns 404 for an unknown provider", async () => {
    const res = await GET(oauthRequest("facebook"), ctx("facebook"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when the provider isn't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await GET(oauthRequest("google"), ctx("google"));
    expect(res.status).toBe(500);
  });

  it("redirects to Google's authorize endpoint with the expected query params", async () => {
    const res = await GET(oauthRequest("google"), ctx("google"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") || "";
    const url = new URL(location);

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("redirect_uri")).toContain(
      "/api/v3/auth/oauth/google/callback",
    );
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("signs a state that verifies against the requested provider only", async () => {
    const res = await GET(oauthRequest("google"), ctx("google"));
    const url = new URL(res.headers.get("location") || "");
    const state = url.searchParams.get("state")!;

    expect(verifyOAuthState(state, "google").ok).toBe(true);
    expect(verifyOAuthState(state, "github").ok).toBe(false);
  });

  it("redirects to GitHub's authorize endpoint without the Google-only prompt param", async () => {
    process.env.GITHUB_CLIENT_ID = "github-client-id";
    process.env.GITHUB_CLIENT_SECRET = "github-client-secret";
    const res = await GET(oauthRequest("github"), ctx("github"));
    const url = new URL(res.headers.get("location") || "");

    expect(url.origin + url.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
    expect(url.searchParams.has("prompt")).toBe(false);
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  describe("discord (shares DISCORD_CLIENT_ID with the account-linking flow)", () => {
    afterEach(() => {
      delete process.env.DISCORD_CLIENT_ID;
      delete process.env.DISCORD_CLIENT_SECRET;
    });

    it("redirects to Discord's authorize endpoint", async () => {
      process.env.DISCORD_CLIENT_ID = "discord-client-id";
      process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
      const res = await GET(oauthRequest("discord"), ctx("discord"));
      const url = new URL(res.headers.get("location") || "");

      expect(url.origin + url.pathname).toBe(
        "https://discord.com/api/oauth2/authorize",
      );
      expect(url.searchParams.get("scope")).toBe("identify email");
      expect(url.searchParams.get("redirect_uri")).toContain(
        "/api/v3/auth/oauth/discord/callback",
      );
    });

    it("is not configured when only DISCORD_CLIENT_ID is set (needs the secret too)", async () => {
      process.env.DISCORD_CLIENT_ID = "discord-client-id";
      const res = await GET(oauthRequest("discord"), ctx("discord"));
      expect(res.status).toBe(500);
    });
  });

  describe("?action=link (Google/GitHub account-linking)", () => {
    it("requires an existing session", async () => {
      const res = await GET(
        oauthRequest("google", "action=link"),
        ctx("google"),
      );
      expect(res.status).toBe(401);
    });

    it("refuses to link Discord through this route", async () => {
      process.env.DISCORD_CLIENT_ID = "discord-client-id";
      process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 7 });

      const res = await GET(
        oauthRequest("discord", "action=link"),
        ctx("discord"),
      );
      expect(res.status).toBe(400);
      delete process.env.DISCORD_CLIENT_ID;
      delete process.env.DISCORD_CLIENT_SECRET;
    });

    it("signs a state bound to the current session's userId once logged in", async () => {
      cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
      sessionRow = defaultSessionRow({ user_id: 55 });

      const res = await GET(
        oauthRequest("google", "action=link"),
        ctx("google"),
      );
      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location") || "");
      const state = url.searchParams.get("state")!;

      const verified = verifyOAuthState(state, "google");
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload.purpose).toBe("link");
        expect(verified.payload.userId).toBe(55);
      }
    });

    it("does not require a session, and signs no purpose, for a plain sign-in", async () => {
      const res = await GET(oauthRequest("google"), ctx("google"));
      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location") || "");
      const state = url.searchParams.get("state")!;

      const verified = verifyOAuthState(state, "google");
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload.purpose).toBeUndefined();
        expect(verified.payload.userId).toBeUndefined();
      }
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
