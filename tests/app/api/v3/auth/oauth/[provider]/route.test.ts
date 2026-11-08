import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeCookieStore,
  makeHeaderStore,
  defaultSessionRow,
} from "../../_test-harness";

/**
 * Route-level tests for /api/v3/auth/oauth/[provider] (GET starts the
 * OAuth sign-up/sign-in flow, POST its `?action=link` account-linking
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
// password_hash for the re-authentication lookup. undefined means no row.
let storedHash: string | null | undefined = undefined;
let rateLimitBucketFull = false;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const s = sql.trim();
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
const { GET, POST } = await import("@/app/api/v3/auth/oauth/[provider]/route");
const { verifyOAuthState, OAUTH_NONCE_COOKIE } =
  await import("@/lib/auth/oauth-state");
const { hashPassword } = await import("@/lib/auth/password-hash");

const LINK_PASSWORD = "the-account-password";
const linkPasswordHash = await hashPassword(LINK_PASSWORD);

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function oauthRequest(provider: string, query?: string): Request {
  const suffix = query ? `?${query}` : "";
  return new Request(`http://localhost/api/v3/auth/oauth/${provider}${suffix}`);
}

function linkPost(provider: string, body?: unknown, query = "action=link") {
  return new Request(
    `http://localhost/api/v3/auth/oauth/${provider}?${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

function signedIn(overrides: Record<string, unknown> = {}) {
  cookieState.set(AUTH_SESSION_COOKIE_NAME, "session-1");
  sessionRow = defaultSessionRow(overrides);
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  mockQuery.mockClear();
  cookieState.clear();
  headerState.clear();
  sessionRow = null;
  storedHash = undefined;
  rateLimitBucketFull = false;
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

  // ?redirect= is how a team invite or an emailed scan link survives a sign-in.
  describe("?redirect= on a plain sign-in", () => {
    function signedPayload(res: Response) {
      const location = new URL(res.headers.get("location") || "");
      const verified = verifyOAuthState(
        location.searchParams.get("state")!,
        "google",
      );
      if (!verified.ok) throw new Error(verified.reason);
      return verified.payload;
    }

    it("signs a same-origin path into the state", async () => {
      const res = await GET(
        oauthRequest(
          "google",
          `intent=login&redirect=${encodeURIComponent("/history?scan=x")}`,
        ),
        ctx("google"),
      );
      expect(signedPayload(res).redirect).toBe("/history?scan=x");
    });

    it.each([
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
    ])("leaves %s out of the state", async (target) => {
      const res = await GET(
        oauthRequest("google", `redirect=${encodeURIComponent(target)}`),
        ctx("google"),
      );
      expect(res.status).toBe(307);
      expect(signedPayload(res).redirect).toBeUndefined();
    });

    it("signs no redirect when none was asked for", async () => {
      const res = await GET(oauthRequest("google"), ctx("google"));
      expect(signedPayload(res).redirect).toBeUndefined();
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

    it("cannot be started by a navigation, which has no way to carry the password", async () => {
      signedIn({ user_id: 55 });

      const res = await GET(
        oauthRequest("google", "action=link"),
        ctx("google"),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Confirm your password first");
      expect(res.headers.get("location")).toBeNull();
    });

    it("signs a state bound to the session's userId once the password checks out", async () => {
      signedIn({ user_id: 55 });
      storedHash = linkPasswordHash;

      const res = await POST(
        linkPost("google", { password: LINK_PASSWORD }),
        ctx("google"),
      );

      expect(res.status).toBe(200);
      const url = new URL((await res.json()).url);
      expect(url.origin + url.pathname).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(url.searchParams.get("redirect_uri")).toContain(
        "/api/v3/auth/oauth/google/callback",
      );
      const verified = verifyOAuthState(
        url.searchParams.get("state")!,
        "google",
      );
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload.purpose).toBe("link");
        expect(verified.payload.userId).toBe(55);
      }
    });

    it("refuses a wrong password and signs no state", async () => {
      signedIn({ user_id: 55 });
      storedHash = linkPasswordHash;

      const res = await POST(
        linkPost("google", { password: "not-the-password" }),
        ctx("google"),
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.url).toBeUndefined();
      expect(body.error).toBeTruthy();
    });

    it("asks for the password when the account has one and none was sent", async () => {
      signedIn({ user_id: 55 });
      storedHash = linkPasswordHash;

      const res = await POST(linkPost("google", {}), ctx("google"));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Confirm your password first");
    });

    it("takes a password-less account's empty post", async () => {
      signedIn({ user_id: 55 });
      storedHash = null;

      const res = await POST(linkPost("google"), ctx("google"));

      expect(res.status).toBe(200);
      expect((await res.json()).url).toContain("accounts.google.com");
    });

    it("stops guessing the password once the attempt budget is spent", async () => {
      signedIn({ user_id: 55 });
      storedHash = linkPasswordHash;
      rateLimitBucketFull = true;

      const res = await POST(
        linkPost("google", { password: LINK_PASSWORD }),
        ctx("google"),
      );

      expect(res.status).toBe(429);
      expect(
        mockQuery.mock.calls.some(([sql]) =>
          String(sql).includes("SELECT password_hash"),
        ),
      ).toBe(false);
    });

    it("requires a session on the POST too", async () => {
      const res = await POST(
        linkPost("google", { password: LINK_PASSWORD }),
        ctx("google"),
      );
      expect(res.status).toBe(401);
    });

    it("refuses Discord on the POST too", async () => {
      process.env.DISCORD_CLIENT_ID = "discord-client-id";
      process.env.DISCORD_CLIENT_SECRET = "discord-client-secret";
      signedIn({ user_id: 7 });

      const res = await POST(linkPost("discord", {}), ctx("discord"));

      expect(res.status).toBe(400);
      delete process.env.DISCORD_CLIENT_ID;
      delete process.env.DISCORD_CLIENT_SECRET;
    });

    it("has no POST for anything but linking", async () => {
      signedIn({ user_id: 7 });
      storedHash = null;

      const res = await POST(
        linkPost("google", {}, "intent=login"),
        ctx("google"),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).url).toBeUndefined();
    });

    it("answers 404 and 500 on the POST as the GET does", async () => {
      expect(
        (await POST(linkPost("facebook", {}), ctx("facebook"))).status,
      ).toBe(404);
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      expect((await POST(linkPost("google", {}), ctx("google"))).status).toBe(
        500,
      );
    });

    // An impersonation session reaches this route as the customer. Linking the
    // staff member's own identity would leave a passwordless way into the
    // customer's account after impersonation ends, with nothing attributing it.
    describe("through an impersonation session", () => {
      it("refuses the GET with 403, and no state or cookie", async () => {
        signedIn({ user_id: 5, impersonated_by: 1 });

        const res = await GET(
          oauthRequest("google", "action=link"),
          ctx("google"),
        );

        expect(res.status).toBe(403);
        expect((await res.json()).impersonationBlocked).toBe(true);
        expect(res.headers.get("location")).toBeNull();
        expect(res.headers.get("set-cookie") || "").not.toContain(
          OAUTH_NONCE_COOKIE,
        );
      });

      it("refuses the POST with 403 before looking at any password", async () => {
        signedIn({ user_id: 5, impersonated_by: 1 });
        storedHash = linkPasswordHash;

        const res = await POST(
          linkPost("google", { password: LINK_PASSWORD }),
          ctx("google"),
        );

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.impersonationBlocked).toBe(true);
        expect(body.url).toBeUndefined();
        expect(
          mockQuery.mock.calls.some(([sql]) =>
            String(sql).includes("SELECT password_hash"),
          ),
        ).toBe(false);
      });
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
      // resolveAppUrl() reads the settings table on every request (that's
      // the point -- it's what makes the redirect_uri DB-admin-override
      // aware), but the session-lookup query from getSession() must still
      // never fire for a plain sign-in -- that's what this test proves.
      expect(
        mockQuery.mock.calls.some(([sql]) =>
          String(sql).includes("SELECT s.user_id"),
        ),
      ).toBe(false);
    });
  });
});
