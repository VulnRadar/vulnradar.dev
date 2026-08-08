import { describe, it, expect, beforeEach, vi } from "vitest";
import { exchangeOAuthCode, fetchOAuthUserInfo } from "@/lib/auth/oauth-userinfo";

/**
 * Unit tests for the OAuth token exchange + userinfo normalization used by
 * app/api/v3/auth/oauth/[provider]/callback/route.ts. Mocked at the network
 * boundary only (global fetch) -- every provider's quirks (GitHub's
 * 200-with-error-field token response, GitHub's separate /user/emails call,
 * Google's email_verified boolean) are exercised for real.
 */

process.env.GOOGLE_CLIENT_ID = "google-id";
process.env.GOOGLE_CLIENT_SECRET = "google-secret";
process.env.GITHUB_CLIENT_ID = "github-id";
process.env.GITHUB_CLIENT_SECRET = "github-secret";
process.env.DISCORD_CLIENT_ID = "discord-id";
process.env.DISCORD_CLIENT_SECRET = "discord-secret";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("exchangeOAuthCode", () => {
  it("returns null when the provider isn't configured", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const result = await exchangeOAuthCode("google", "code", "https://x/cb");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    process.env.GOOGLE_CLIENT_ID = "google-id";
  });

  it("returns the access token on a successful exchange", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "tok-123" }), { status: 200 }),
    );
    const result = await exchangeOAuthCode("google", "code", "https://x/cb");
    expect(result).toEqual({ accessToken: "tok-123" });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 400 }));
    const result = await exchangeOAuthCode("google", "code", "https://x/cb");
    expect(result).toBeNull();
  });

  it("returns null when GitHub returns 200 with an error field in the body", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "bad_verification_code" }),
        { status: 200 },
      ),
    );
    const result = await exchangeOAuthCode("github", "code", "https://x/cb");
    expect(result).toBeNull();
  });

  it("returns null when the response body has no access_token", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const result = await exchangeOAuthCode("discord", "code", "https://x/cb");
    expect(result).toBeNull();
  });

  it("returns null instead of throwing when the network request fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network blip"));
    const result = await exchangeOAuthCode("google", "code", "https://x/cb");
    expect(result).toBeNull();
  });
});

describe("fetchOAuthUserInfo: google", () => {
  it("normalizes a verified Google account", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          email: "user@example.com",
          email_verified: true,
          name: "Ada Lovelace",
          picture: "https://example.com/pic.png",
        }),
        { status: 200 },
      ),
    );
    const info = await fetchOAuthUserInfo("google", "tok");
    expect(info).toEqual({
      email: "user@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/pic.png",
    });
  });

  it("treats an unverified Google email as unverified", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ email: "user@example.com", email_verified: false }),
        { status: 200 },
      ),
    );
    const info = await fetchOAuthUserInfo("google", "tok");
    expect(info?.emailVerified).toBe(false);
  });

  it("returns null when there's no email at all", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const info = await fetchOAuthUserInfo("google", "tok");
    expect(info).toBeNull();
  });
});

describe("fetchOAuthUserInfo: github", () => {
  it("prefers the verified primary address from /user/emails over /user.email", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ login: "ada", name: "Ada Lovelace", email: null, avatar_url: "a.png" }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { email: "secondary@example.com", primary: false, verified: true },
            { email: "primary@example.com", primary: true, verified: true },
          ]),
          { status: 200 },
        ),
      );
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info).toEqual({
      email: "primary@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
      avatarUrl: "a.png",
    });
  });

  it("falls back to the login as name when no display name is set", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: "ada", email: "ada@example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { email: "ada@example.com", primary: true, verified: true },
          ]),
          { status: 200 },
        ),
      );
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info?.name).toBe("ada");
  });

  it("does not claim a verified email when /user/emails has no verified primary", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ login: "ada", email: "ada@example.com" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { email: "ada@example.com", primary: true, verified: false },
          ]),
          { status: 200 },
        ),
      );
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info?.emailVerified).toBe(false);
  });

  it("returns null when the /user request itself fails", async () => {
    mockFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info).toBeNull();
  });
});

describe("fetchOAuthUserInfo: discord", () => {
  it("normalizes a verified Discord account and builds the CDN avatar URL", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "999",
          username: "TestUser",
          email: "user@example.com",
          verified: true,
          avatar: "avatarhash",
        }),
        { status: 200 },
      ),
    );
    const info = await fetchOAuthUserInfo("discord", "tok");
    expect(info).toEqual({
      email: "user@example.com",
      emailVerified: true,
      name: "TestUser",
      avatarUrl: "https://cdn.discordapp.com/avatars/999/avatarhash.png",
    });
  });

  it("treats verified: false as unverified", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "999", username: "TestUser", email: "u@example.com", verified: false }),
        { status: 200 },
      ),
    );
    const info = await fetchOAuthUserInfo("discord", "tok");
    expect(info?.emailVerified).toBe(false);
  });

  it("returns null on a failed request instead of throwing", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network blip"));
    const info = await fetchOAuthUserInfo("discord", "tok");
    expect(info).toBeNull();
  });
});
