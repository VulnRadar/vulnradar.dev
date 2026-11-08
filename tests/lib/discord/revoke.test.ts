/**
 * Revoking at Discord. Best effort by contract: the caller is removing a
 * connection or an account, and a Discord outage must never stop that, so every
 * failure here is logged and swallowed. The fetch boundary is the only mock
 * besides the database.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";

process.env.API_KEY_ENCRYPTION_KEY = "c".repeat(64);

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { encryptApiKey } = await import("@/lib/auth/crypto");
const { revokeDiscordTokens, revokeStoredDiscordTokens } =
  await import("@/lib/discord/revoke");

const mockFetch = vi.fn();
let errorLog: MockInstance;

beforeEach(() => {
  mockQuery.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("DISCORD_CLIENT_ID", "client-1");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "secret-1");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function sentForms() {
  return mockFetch.mock.calls.map(
    ([, init]) => new URLSearchParams(String(init.body)),
  );
}

describe("revokeDiscordTokens", () => {
  it("posts each token to the revoke endpoint with client authentication", async () => {
    await revokeDiscordTokens(3, {
      accessToken: encryptApiKey("access-plain"),
      refreshToken: encryptApiKey("refresh-plain"),
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of mockFetch.mock.calls) {
      expect(url).toBe("https://discord.com/api/oauth2/token/revoke");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(init.headers.Authorization).toBe(
        `Basic ${Buffer.from("client-1:secret-1").toString("base64")}`,
      );
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    const forms = sentForms();
    expect(forms.map((f) => f.get("token")).sort()).toEqual([
      "access-plain",
      "refresh-plain",
    ]);
    expect(forms.map((f) => f.get("token_type_hint")).sort()).toEqual([
      "access_token",
      "refresh_token",
    ]);
  });

  it("revokes the access token alone when the row has no refresh token", async () => {
    await revokeDiscordTokens(3, {
      accessToken: encryptApiKey("access-plain"),
      refreshToken: null,
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does not let one undecryptable token stop the other", async () => {
    await revokeDiscordTokens(3, {
      accessToken: "not-a-ciphertext",
      refreshToken: encryptApiKey("refresh-plain"),
    });

    expect(sentForms().map((f) => f.get("token"))).toEqual(["refresh-plain"]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("logs a refusal without the token and does not throw", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(
      revokeDiscordTokens(3, {
        accessToken: encryptApiKey("access-plain"),
        refreshToken: encryptApiKey("refresh-plain"),
      }),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("access-plain");
  });

  it("does not throw on a network failure", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    await expect(
      revokeDiscordTokens(3, {
        accessToken: encryptApiKey("access-plain"),
        refreshToken: null,
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it("logs and calls nothing when the server has no Discord client", async () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "");

    await revokeDiscordTokens(3, {
      accessToken: encryptApiKey("access-plain"),
      refreshToken: null,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("revokeStoredDiscordTokens", () => {
  it("revokes what the row holds", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          access_token: encryptApiKey("access-plain"),
          refresh_token: encryptApiKey("refresh-plain"),
        },
      ],
    });

    await revokeStoredDiscordTokens(3);

    expect(mockQuery.mock.calls[0][1]).toEqual([3]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a connection", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await revokeStoredDiscordTokens(3);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  it("swallows a database failure", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(revokeStoredDiscordTokens(3)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });
});
