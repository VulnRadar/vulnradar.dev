import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  exchangeOAuthCode,
  fetchOAuthUserInfo,
} from "@/lib/auth/oauth-userinfo";

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

// Every failure here is now written to console.error, which is what the admin
// Error Logs persist. Spied for the whole file so the suite's own failure
// cases do not print, and so the logging describe at the bottom can read it.
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockFetch.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
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
      new Response(JSON.stringify({ access_token: "tok-123" }), {
        status: 200,
      }),
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
      new Response(JSON.stringify({ error: "bad_verification_code" }), {
        status: 200,
      }),
    );
    const result = await exchangeOAuthCode("github", "code", "https://x/cb");
    expect(result).toBeNull();
  });

  it("returns null when the response body has no access_token", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
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
          sub: "goog-account-123",
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
      id: "goog-account-123",
      email: "user@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
      avatarUrl: "https://example.com/pic.png",
    });
    // Google has no @handle: the github-only login field stays absent.
    expect(info?.login).toBeUndefined();
  });

  it("returns a null id when the provider response has no `sub` claim", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ email: "user@example.com", email_verified: true }),
        { status: 200 },
      ),
    );
    const info = await fetchOAuthUserInfo("google", "tok");
    expect(info?.id).toBeNull();
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
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    const info = await fetchOAuthUserInfo("google", "tok");
    expect(info).toBeNull();
  });
});

describe("fetchOAuthUserInfo: github", () => {
  it("prefers the verified primary address from /user/emails over /user.email", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            login: "ada",
            name: "Ada Lovelace",
            email: null,
            avatar_url: "a.png",
          }),
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
      id: "42",
      email: "primary@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
      login: "ada",
      avatarUrl: "a.png",
    });
  });

  it("caps the GitHub avatar size without clobbering its existing query string", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            login: "ada",
            name: "Ada Lovelace",
            email: "ada@example.com",
            avatar_url: "https://avatars.githubusercontent.com/u/42?v=4",
          }),
          { status: 200 },
        ),
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
    expect(info?.avatarUrl).toBe(
      "https://avatars.githubusercontent.com/u/42?v=4&s=128",
    );
  });

  it("captures the @handle (login) separately from the display name", async () => {
    // The display name and the login differ, and only the login forms a
    // valid github.com/<login> URL -- so both must be kept, not just one.
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 7,
            login: "Shito-HENG",
            name: "x5n4k33y35x",
            email: null,
            avatar_url: "a.png",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { email: "s@example.com", primary: true, verified: true },
          ]),
          { status: 200 },
        ),
      );
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info?.name).toBe("x5n4k33y35x");
    expect(info?.login).toBe("Shito-HENG");
  });

  it("returns a null id when the /user response has no numeric id", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ login: "ada", email: "ada@example.com" }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    const info = await fetchOAuthUserInfo("github", "tok");
    expect(info?.id).toBeNull();
  });

  it("falls back to the login as name when no display name is set", async () => {
    mockFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ login: "ada", email: "ada@example.com" }),
          {
            status: 200,
          },
        ),
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
        new Response(
          JSON.stringify({ login: "ada", email: "ada@example.com" }),
          {
            status: 200,
          },
        ),
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
    mockFetch.mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    );
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
      id: "999",
      email: "user@example.com",
      emailVerified: true,
      name: "TestUser",
      // ?size=128 is not cosmetic: images.unoptimized is on, so an uncapped
      // Discord avatar is served at full resolution and downloaded whole to
      // paint a 14px circle.
      avatarUrl:
        "https://cdn.discordapp.com/avatars/999/avatarhash.png?size=128",
    });
    // Discord has no @handle either: the github-only login field stays absent.
    expect(info?.login).toBeUndefined();
  });

  it("treats verified: false as unverified", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "999",
          username: "TestUser",
          email: "u@example.com",
          verified: false,
        }),
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

/**
 * The callback turns any null from this module into a bare redirect, so the
 * log written here is the only place a rotated secret, a redirect_uri that no
 * longer matches or a provider outage can be told apart. Each failure path
 * must write exactly one console.error naming the provider, the stage, the
 * status and the provider's error code, and none of them may write anything
 * that came from the person signing in or from our own secrets.
 */
describe("failure logging", () => {
  function jsonResponse(body: unknown, status: number) {
    return new Response(JSON.stringify(body), { status });
  }

  /** The one logged call, as [message, context]. */
  function onlyLog(): [string, Record<string, unknown>] {
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, ctx] = errorSpy.mock.calls[0];
    return [message as string, ctx as Record<string, unknown>];
  }

  describe("token exchange", () => {
    it("logs the status and error code of a non-2xx answer", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "invalid_client" }, 401),
      );

      expect(await exchangeOAuthCode("google", "c", "https://x/cb")).toBeNull();

      const [message, ctx] = onlyLog();
      expect(message).toBe("[oauth] token endpoint returned an error status");
      expect(ctx).toEqual({
        provider: "google",
        stage: "token",
        status: 401,
        providerError: "invalid_client",
      });
    });

    it("logs the status alone when the error body is not JSON", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response("Bad gateway", { status: 502 }),
      );

      await exchangeOAuthCode("discord", "c", "https://x/cb");

      const [, ctx] = onlyLog();
      expect(ctx).toEqual({ provider: "discord", stage: "token", status: 502 });
    });

    it("logs GitHub's 200-with-error body, which a status check alone misses", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: "incorrect_client_credentials" }, 200),
      );

      await exchangeOAuthCode("github", "c", "https://x/cb");

      const [message, ctx] = onlyLog();
      expect(message).toBe("[oauth] token response carried no access token");
      expect(ctx).toEqual({
        provider: "github",
        stage: "token",
        status: 200,
        providerError: "incorrect_client_credentials",
      });
    });

    it("logs a 200 that has neither an error nor an access token", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}, 200));

      await exchangeOAuthCode("discord", "c", "https://x/cb");

      const [, ctx] = onlyLog();
      expect(ctx).toEqual({ provider: "discord", stage: "token", status: 200 });
    });

    it("logs a 200 whose body is not JSON", async () => {
      mockFetch.mockResolvedValueOnce(new Response("<html>", { status: 200 }));

      await exchangeOAuthCode("google", "c", "https://x/cb");

      const [message, ctx] = onlyLog();
      expect(message).toBe("[oauth] token response was not JSON");
      expect(ctx).toEqual({ provider: "google", stage: "token", status: 200 });
    });

    it("logs a network failure with the Error, so the row keeps its stack", async () => {
      const cause = new Error("connect ECONNREFUSED");
      mockFetch.mockRejectedValueOnce(cause);

      await exchangeOAuthCode("github", "c", "https://x/cb");

      const [message, ctx, err] = errorSpy.mock.calls[0];
      expect(message).toBe("[oauth] token request failed");
      expect(ctx).toEqual({ provider: "github", stage: "token" });
      expect(err).toBe(cause);
    });

    it("logs a provider with no client credentials configured, and never calls out", async () => {
      delete process.env.DISCORD_CLIENT_SECRET;
      try {
        await exchangeOAuthCode("discord", "c", "https://x/cb");
      } finally {
        process.env.DISCORD_CLIENT_SECRET = "discord-secret";
      }

      const [message, ctx] = onlyLog();
      expect(message).toBe("[oauth] client credentials are not configured");
      expect(ctx).toEqual({ provider: "discord", stage: "token" });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("does not log anything when the exchange succeeds", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "tok-123" }, 200),
      );

      await exchangeOAuthCode("google", "c", "https://x/cb");

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("userinfo", () => {
    it.each(["google", "github", "discord"] as const)(
      "logs a %s userinfo answer that is not 2xx, with its status and error code",
      async (provider) => {
        mockFetch.mockResolvedValueOnce(
          jsonResponse({ error: "invalid_token" }, 401),
        );

        expect(await fetchOAuthUserInfo(provider, "tok")).toBeNull();

        const [message, ctx] = onlyLog();
        expect(message).toBe(
          "[oauth] userinfo endpoint returned an error status",
        );
        expect(ctx).toEqual({
          provider,
          stage: "userinfo",
          status: 401,
          providerError: "invalid_token",
        });
      },
    );

    it("logs GitHub's plain {message} 401, which has no error code to report", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ message: "Bad credentials" }, 401),
      );

      await fetchOAuthUserInfo("github", "tok");

      const [, ctx] = onlyLog();
      expect(ctx).toEqual({
        provider: "github",
        stage: "userinfo",
        status: 401,
      });
    });

    it.each(["google", "discord"] as const)(
      "logs a %s answer that carries no email",
      async (provider) => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ id: "1" }, 200));

        expect(await fetchOAuthUserInfo(provider, "tok")).toBeNull();

        const [message, ctx] = onlyLog();
        expect(message).toBe("[oauth] userinfo response has no email");
        expect(ctx).toEqual({ provider, stage: "userinfo", status: 200 });
      },
    );

    it.each(["google", "github", "discord"] as const)(
      "logs a %s userinfo network failure with the Error",
      async (provider) => {
        const cause = new Error("socket hang up");
        mockFetch.mockRejectedValueOnce(cause);

        await fetchOAuthUserInfo(provider, "tok");

        const [message, ctx, err] = errorSpy.mock.calls[0];
        expect(message).toBe("[oauth] userinfo request failed");
        expect(ctx).toEqual({ provider, stage: "userinfo" });
        expect(err).toBe(cause);
      },
    );

    it("logs GitHub's emails endpoint being refused, because the sign-in carries on unverified", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ id: 1, login: "ada", email: "ada@example.com" }, 200),
        )
        .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404));

      const info = await fetchOAuthUserInfo("github", "tok");

      // Still a result, as before: only the log is new.
      expect(info?.emailVerified).toBe(false);
      const [message, ctx] = onlyLog();
      expect(message).toBe("[oauth] emails endpoint rejected the request");
      expect(ctx).toEqual({ provider: "github", stage: "emails", status: 404 });
    });

    it("does not log when GitHub's emails endpoint answers", async () => {
      mockFetch
        .mockResolvedValueOnce(
          jsonResponse({ id: 1, login: "ada", email: "ada@example.com" }, 200),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            [{ email: "ada@example.com", primary: true, verified: true }],
            200,
          ),
        );

      await fetchOAuthUserInfo("github", "tok");

      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("what is never written", () => {
    // The authorization code, the access token and the client secret are the
    // three values in this module that must not reach system_error_logs, which
    // every staff role can read. Providers do echo them: error_description
    // often quotes the code it rejected.
    const CODE = "authz-code-DO-NOT-LOG";
    const TOKEN = "access-token-DO-NOT-LOG";
    const REDIRECT = "https://example.test/cb?state=STATE-DO-NOT-LOG";

    function everythingLogged(): string {
      return JSON.stringify(
        errorSpy.mock.calls.map((call) =>
          call.map((arg: unknown) =>
            arg instanceof Error ? `${arg.name}: ${arg.message}` : arg,
          ),
        ),
      );
    }

    it("keeps the code, the redirect URI and the secret out of a token failure that quotes them", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: `The code ${CODE} is invalid for ${REDIRECT}, client google-secret`,
            echoed_code: CODE,
          },
          400,
        ),
      );

      await exchangeOAuthCode("google", CODE, REDIRECT);

      const logged = everythingLogged();
      expect(logged).toContain("invalid_grant");
      expect(logged).not.toContain(CODE);
      expect(logged).not.toContain("STATE-DO-NOT-LOG");
      expect(logged).not.toContain("google-secret");
    });

    it("keeps an access token out of a userinfo failure that quotes it", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          {
            error: "invalid_token",
            error_description: `Token ${TOKEN} has expired`,
          },
          401,
        ),
      );

      await fetchOAuthUserInfo("google", TOKEN);

      const logged = everythingLogged();
      expect(logged).toContain("invalid_token");
      expect(logged).not.toContain(TOKEN);
    });

    it("drops an `error` value that is prose rather than a code", async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: `Code ${CODE} was already redeemed` }, 400),
      );

      await exchangeOAuthCode("github", CODE, REDIRECT);

      const [, ctx] = errorSpy.mock.calls[0];
      expect(ctx).toEqual({ provider: "github", stage: "token", status: 400 });
      expect(everythingLogged()).not.toContain(CODE);
    });

    it("drops an `error` that is an object or an over-long string", async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ error: { code: 401 } }, 401))
        .mockResolvedValueOnce(jsonResponse({ error: "x".repeat(200) }, 400));

      await fetchOAuthUserInfo("google", TOKEN);
      await exchangeOAuthCode("google", CODE, REDIRECT);

      for (const [, ctx] of errorSpy.mock.calls) {
        expect(ctx).not.toHaveProperty("providerError");
      }
    });
  });
});
