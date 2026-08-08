import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Route-level tests for GET /api/v3/auth/oauth/[provider] (start the
 * OAuth sign-up/sign-in flow). No database or network calls happen on
 * this path -- it only builds a redirect URL -- so nothing needs mocking
 * at the network/DB boundary beyond the env vars that gate configuration.
 */

process.env.GOOGLE_CLIENT_ID = "google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const { GET } = await import("@/app/api/v3/auth/oauth/[provider]/route");
const { verifyOAuthState } = await import("@/lib/auth/oauth-state");

function ctx(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

function oauthRequest(provider: string): Request {
  return new Request(`http://localhost/api/v3/auth/oauth/${provider}`);
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
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
});
