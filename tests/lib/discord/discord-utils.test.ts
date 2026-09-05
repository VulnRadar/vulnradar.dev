import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * lib/discord/discord-utils.ts is DB reads/writes, an outbound email send,
 * AES-256-GCM token encryption, and (since the refresh landed) one outbound
 * call to Discord's token endpoint, which is stubbed per-test rather than
 * globally so the suites that predate it keep proving no request is made.
 * Mocked at the database boundary (pg pool, same pattern
 * as tests/lib/notifications/user-notifications.test.ts) and the email
 * boundary (lib/email/email's sendEmail, same pattern as
 * tests/lib/notifications/notifications.test.ts), keeping email2FACodeEmail
 * and the AES-256-GCM crypto real per this repo's "mock at the network/
 * database boundary, never below it" rule.
 */

const mockQuery = vi.fn();
// The code expiry is read from the live admin setting rather than a hardcoded
// SQL interval, so changing EMAIL_2FA_CODE_EXPIRY_MINUTES actually takes
// effect. Mocked here so the test does not depend on system_settings and can
// assert the value is threaded into the INSERT.
const mockGetSetting = vi.fn<(key: string) => Promise<number>>();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (key: string) => mockGetSetting(key),
}));

vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSendEmail = vi.fn();
vi.mock("@/lib/email/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/email")>();
  return {
    ...actual,
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  };
});

const {
  sendDiscordEmail2FACode,
  updateDiscordTokens,
  updateDiscordTokensForUser,
  getDiscordTokens,
  getDiscordUserConnection,
  getUserTwoFAConfig,
  refreshDiscordAccessToken,
  DiscordReauthRequiredError,
} = await import("@/lib/discord/discord-utils");
const { encryptApiKey, decryptApiKey } = await import("@/lib/auth/crypto");

const ENCRYPTION_KEY = "b".repeat(64);
let previousKey: string | undefined;

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(10);
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue(undefined);
  previousKey = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterEach(() => {
  if (previousKey === undefined) {
    delete process.env.API_KEY_ENCRYPTION_KEY;
  } else {
    process.env.API_KEY_ENCRYPTION_KEY = previousKey;
  }
});

describe("sendDiscordEmail2FACode", () => {
  it("deletes old codes, stores a salted hash of a new 6-digit code, and emails it", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    await sendDiscordEmail2FACode(42, "user@example.com");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [deleteSql, deleteParams] = mockQuery.mock.calls[0];
    expect(deleteSql).toContain("DELETE FROM email_2fa_codes");
    expect(deleteParams).toEqual([42]);

    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO email_2fa_codes");
    const [userId, codeHash, codeSalt, expiryMinutes] = insertParams;
    expect(userId).toBe(42);
    expect(typeof codeHash).toBe("string");
    expect(typeof codeSalt).toBe("string");
    // The expiry is a bound parameter from the admin setting, not a literal
    // baked into the SQL, so an admin change to it takes effect.
    expect(mockGetSetting).toHaveBeenCalledWith(
      "EMAIL_2FA_CODE_EXPIRY_MINUTES",
    );
    expect(expiryMinutes).toBe(10);
    expect(insertSql).toContain("$4 * INTERVAL '1 minute'");

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.to).toBe("user@example.com");

    // Pull the plaintext code back out of the (real) email body and verify
    // it hashes to exactly what was stored, proving the salted hash matches
    // the code that was actually sent.
    const match = /sign-in code is (\d{6})/.exec(emailArgs.text);
    expect(match).not.toBeNull();
    const code = match![1];
    const expectedHash = createHash("sha256")
      .update(`${codeSalt}:${code}`)
      .digest("hex");
    expect(codeHash).toBe(expectedHash);
  });

  it("swallows errors and logs, without throwing (background operation)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValueOnce(new Error("db down"));

    await expect(
      sendDiscordEmail2FACode(1, "a@b.com"),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("updateDiscordTokens", () => {
  it("encrypts the access + refresh tokens at rest and updates by discord_id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const expiresAt = new Date("2026-01-01T00:00:00Z");

    await updateDiscordTokens(
      "discord-123",
      "access-tok",
      "refresh-tok",
      expiresAt,
      true,
    );

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("UPDATE discord_connections");
    const [encAccess, encRefresh, exp, guildJoined, discordId] = params;

    expect(decryptApiKey(encAccess)).toBe("access-tok");
    expect(decryptApiKey(encRefresh)).toBe("refresh-tok");
    expect(exp).toBe(expiresAt);
    expect(guildJoined).toBe(true);
    expect(discordId).toBe("discord-123");

    // The ciphertext must not leak the plaintext.
    expect(encAccess).not.toContain("access-tok");
    expect(encRefresh).not.toContain("refresh-tok");
  });
});

describe("getDiscordTokens", () => {
  it("decrypts the stored tokens for a linked user", async () => {
    const expiresAt = new Date("2026-06-01T00:00:00Z");
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          access_token: encryptApiKey("access-tok"),
          refresh_token: encryptApiKey("refresh-tok"),
          token_expires_at: expiresAt,
          guild_joined: true,
        },
      ],
    });

    const result = await getDiscordTokens(7);

    expect(result).toEqual({
      accessToken: "access-tok",
      refreshToken: "refresh-tok",
      tokenExpiresAt: expiresAt,
      guildJoined: true,
    });
  });

  it("returns null when the user has no linked Discord account", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getDiscordTokens(999)).toBeNull();
  });

  it("throws when the stored ciphertext has been tampered with", async () => {
    const bytes = Buffer.from(encryptApiKey("access-tok"), "base64");
    bytes[bytes.length - 1] ^= 0x01;
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          access_token: bytes.toString("base64"),
          refresh_token: encryptApiKey("refresh-tok"),
          token_expires_at: new Date(),
          guild_joined: false,
        },
      ],
    });

    await expect(getDiscordTokens(1)).rejects.toThrow();
  });
});

describe("getDiscordUserConnection", () => {
  it("returns the linked user id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 55 }] });
    expect(await getDiscordUserConnection("discord-abc")).toBe(55);
  });

  it("returns null when the Discord id is not linked to any user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getDiscordUserConnection("discord-none")).toBeNull();
  });
});

describe("getUserTwoFAConfig", () => {
  it("returns the user's 2FA configuration", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { totp_enabled: true, two_factor_method: "totp", email: "a@b.com" },
      ],
    });

    expect(await getUserTwoFAConfig(3)).toEqual({
      totp_enabled: true,
      two_factor_method: "totp",
      email: "a@b.com",
    });
  });

  it("returns null for an unknown user", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserTwoFAConfig(404)).toBeNull();
  });
});

/**
 * The refresh that never existed.
 *
 * Discord expires an access token after 7 days. The refresh token beside it
 * has been stored, encrypted and re-encrypted on key rotation since Discord
 * sign-in shipped, and nothing ever spent it: getDiscordTokens had no
 * callers outside its own module and no refresh function existed at all.
 */
describe("refreshDiscordAccessToken", () => {
  const previousClientId = process.env.DISCORD_CLIENT_ID;
  const previousClientSecret = process.env.DISCORD_CLIENT_SECRET;
  let mockFetch: ReturnType<typeof vi.fn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.DISCORD_CLIENT_ID = "client-id";
    process.env.DISCORD_CLIENT_SECRET = "client-secret";
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
    if (previousClientId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) {
      delete process.env.DISCORD_CLIENT_SECRET;
    } else {
      process.env.DISCORD_CLIENT_SECRET = previousClientSecret;
    }
  });

  /** The stored row, with both token columns really encrypted (the crypto is
   *  not mocked in this suite) so the exchange has to decrypt to succeed. */
  function storedConnection() {
    return {
      rows: [
        {
          access_token: encryptApiKey("old-access"),
          refresh_token: encryptApiKey("stored-refresh"),
          token_expires_at: new Date("2020-01-01T00:00:00.000Z"),
          guild_joined: false,
        },
      ],
    };
  }

  it("exchanges the stored refresh token and persists the new pair", async () => {
    mockQuery.mockResolvedValueOnce(storedConnection()); // SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 604800,
      }),
    });

    const token = await refreshDiscordAccessToken(7);
    expect(token).toBe("fresh-access");

    // The refresh token that went out is the decrypted stored one, not the
    // ciphertext: sending the ciphertext would fail against Discord in a way
    // no local test would otherwise catch.
    const [, init] = mockFetch.mock.calls[0];
    const body = (init as { body: URLSearchParams }).body;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("stored-refresh");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("UPDATE discord_connections");
    // guild_joined is deliberately untouched: refreshing a token says
    // nothing about server membership.
    expect(updateSql).not.toContain("guild_joined");
    const params = updateParams as [string, string, Date, number];
    expect(decryptApiKey(params[0])).toBe("fresh-access");
    expect(decryptApiKey(params[1])).toBe("fresh-refresh");
    expect(params[3]).toBe(7);
  });

  it("throws a terminal reauth error when Discord rejects the refresh token", async () => {
    mockQuery.mockResolvedValueOnce(storedConnection());
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "invalid_grant" }),
    });

    await expect(refreshDiscordAccessToken(7)).rejects.toBeInstanceOf(
      DiscordReauthRequiredError,
    );
    // Nothing was written: a rejected refresh must not overwrite the pair
    // the user would still have if they re-authorize.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("treats a 5xx as transient rather than as a revoked authorization", async () => {
    mockQuery.mockResolvedValueOnce(storedConnection());
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "upstream down",
    });

    const error = await refreshDiscordAccessToken(7).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DiscordReauthRequiredError);
  });

  it("is terminal when there is no stored connection to refresh", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(refreshDiscordAccessToken(7)).rejects.toBeInstanceOf(
      DiscordReauthRequiredError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses to call Discord at all when the OAuth app is not configured", async () => {
    delete process.env.DISCORD_CLIENT_SECRET;
    await expect(refreshDiscordAccessToken(7)).rejects.toThrow(
      /not configured/i,
    );
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("updateDiscordTokensForUser", () => {
  it("encrypts both tokens at rest and keys on the user id", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const expiresAt = new Date("2026-09-11T00:00:00.000Z");

    await updateDiscordTokensForUser(9, "access", "refresh", expiresAt);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE user_id = $4");
    const values = params as [string, string, Date, number];
    expect(values[0]).not.toBe("access");
    expect(values[1]).not.toBe("refresh");
    expect(decryptApiKey(values[0])).toBe("access");
    expect(decryptApiKey(values[1])).toBe("refresh");
    expect(values[2]).toBe(expiresAt);
    expect(values[3]).toBe(9);
  });
});
