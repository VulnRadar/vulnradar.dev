import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";

/**
 * lib/discord/discord-utils.ts has no outbound `fetch` calls of its own
 * (Discord's HTTP API is called elsewhere, e.g. the OAuth callback route);
 * this file is DB reads/writes, an outbound email send, and AES-256-GCM
 * token encryption. Mocked at the database boundary (pg pool, same pattern
 * as tests/lib/notifications/user-notifications.test.ts) and the email
 * boundary (lib/email/email's sendEmail, same pattern as
 * tests/lib/notifications/notifications.test.ts), keeping email2FACodeEmail
 * and the AES-256-GCM crypto real per this repo's "mock at the network/
 * database boundary, never below it" rule.
 */

const mockQuery = vi.fn();
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
  getDiscordTokens,
  getDiscordUserConnection,
  getUserTwoFAConfig,
} = await import("@/lib/discord/discord-utils");
const { encryptApiKey, decryptApiKey } = await import("@/lib/auth/crypto");

const ENCRYPTION_KEY = "b".repeat(64);
let previousKey: string | undefined;

beforeEach(() => {
  mockQuery.mockReset();
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
    const [userId, codeHash, codeSalt] = insertParams;
    expect(userId).toBe(42);
    expect(typeof codeHash).toBe("string");
    expect(typeof codeSalt).toBe("string");

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
