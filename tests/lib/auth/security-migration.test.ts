/**
 * Tests for lib/auth/security-migration.ts.
 *
 * This runs unattended on every boot (instrumentation.ts awaits it) and it
 * REWRITES users.totp_secret and discord_connections.access_token /
 * refresh_token in place, so a wrong classification is an irreversible loss of
 * every 2FA seed in the database. Only the database boundary is mocked: the
 * real AES-256-GCM pipeline from lib/auth/crypto is used, because "does this
 * value decrypt under the current key" is the exact thing under test, and the
 * key-rotation case is simulated by swapping API_KEY_ENCRYPTION_KEY between
 * producing the ciphertext and running the migration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let totpRows: Row[] = [];
let discordRows: Row[] = [];
let apiKeyRows: Row[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, totp_secret")) return { rows: totpRows };
  if (s.startsWith("SELECT user_id, access_token"))
    return { rows: discordRows };
  if (s.startsWith("SELECT id, key_encrypted FROM api_keys"))
    return { rows: apiKeyRows };
  if (s.startsWith("UPDATE api_keys")) return { rows: [], rowCount: 1 };
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { migratePlaintextSecretsToEncrypted, hashStoredApiKeys } =
  await import("@/lib/auth/security-migration");
const { encryptApiKey } = await import("@/lib/auth/crypto");

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

// 32 chars over the base32 alphabet, exactly what lib/auth/totp.ts's
// generateSecret() produces from 20 random bytes.
const PLAINTEXT_SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function updates() {
  return queries.filter((q) => q.sql.trim().startsWith("UPDATE"));
}

beforeEach(() => {
  queries.length = 0;
  mockQuery.mockClear();
  totpRows = [];
  discordRows = [];
  apiKeyRows = [];
  process.env.API_KEY_ENCRYPTION_KEY = KEY_A;
  delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("migratePlaintextSecretsToEncrypted (TOTP seeds)", () => {
  it("encrypts a genuine plaintext base32 seed exactly once", async () => {
    totpRows = [{ id: 7, totp_secret: PLAINTEXT_SEED }];

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(stats.totpReEncrypted).toBe(1);
    expect(stats.totpUnreadable).toBe(0);
    const writes = updates();
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("UPDATE users SET totp_secret");
    expect(writes[0].params[1]).toBe(7);
    // The value written must not be the plaintext we started with.
    expect(writes[0].params[0]).not.toBe(PLAINTEXT_SEED);
  });

  it("leaves an already-encrypted seed alone (idempotent on a second boot)", async () => {
    totpRows = [{ id: 7, totp_secret: encryptApiKey(PLAINTEXT_SEED) }];

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(stats.totpAlreadyEncrypted).toBe(1);
    expect(stats.totpReEncrypted).toBe(0);
    expect(updates()).toHaveLength(0);
  });

  it("does NOT re-encrypt a ciphertext that no longer decrypts after a key rotation", async () => {
    // The destructive case. Encrypt under key A, then boot under key B (a
    // rotation, a restore from a backup taken under a different key, or an
    // .env copied between environments). The old code decided "does not
    // decrypt" meant "is plaintext" and re-encrypted the ciphertext, losing
    // the seed permanently and reporting it as a successful migration.
    const ciphertextUnderA = encryptApiKey(PLAINTEXT_SEED);
    process.env.API_KEY_ENCRYPTION_KEY = KEY_B;
    totpRows = [{ id: 7, totp_secret: ciphertextUnderA }];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(updates()).toHaveLength(0);
    expect(stats.totpReEncrypted).toBe(0);
    expect(stats.totpAlreadyEncrypted).toBe(0);
    expect(stats.totpUnreadable).toBe(1);
    // It must also be loud: the operator has to learn the key is wrong.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("skips NULL seeds without counting them as anything", async () => {
    totpRows = [{ id: 7, totp_secret: null }];
    const stats = await migratePlaintextSecretsToEncrypted();
    expect(stats.totpScanned).toBe(1);
    expect(stats.totpReEncrypted).toBe(0);
    expect(updates()).toHaveLength(0);
  });
});

describe("migratePlaintextSecretsToEncrypted (Discord tokens)", () => {
  it("encrypts a plaintext access/refresh pair in one UPDATE", async () => {
    discordRows = [
      {
        user_id: 4,
        access_token: "mfa.aBcD3fGh1jK-lMnO_pQrS",
        refresh_token: "rTuVwXyZ0123456789abcdef",
      },
    ];

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(stats.discordReEncrypted).toBe(2);
    const writes = updates();
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("UPDATE discord_connections");
  });

  it("leaves an already-encrypted pair alone", async () => {
    discordRows = [
      {
        user_id: 4,
        access_token: encryptApiKey("mfa.aBcD3fGh1jK-lMnO_pQrS"),
        refresh_token: encryptApiKey("rTuVwXyZ0123456789abcdef"),
      },
    ];

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(stats.discordAlreadyEncrypted).toBe(1);
    expect(updates()).toHaveLength(0);
  });

  it("does NOT re-encrypt Discord tokens that no longer decrypt after a key rotation", async () => {
    const access = encryptApiKey("mfa.aBcD3fGh1jK-lMnO_pQrS");
    const refresh = encryptApiKey("rTuVwXyZ0123456789abcdef");
    process.env.API_KEY_ENCRYPTION_KEY = KEY_B;
    discordRows = [
      { user_id: 4, access_token: access, refresh_token: refresh },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(updates()).toHaveLength(0);
    expect(stats.discordReEncrypted).toBe(0);
    expect(stats.discordUnreadable).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});

/**
 * API keys used to be stored as ciphertext (api_keys.key_encrypted) and are a
 * SHA-256 digest from 4.0.0 on. The ciphertext is the only copy of a 3.9.1 key
 * the server holds, so the boot migration opens it once, writes the digest and
 * drops the ciphertext. Getting this wrong locks every integration out, so the
 * real AES pipeline is used and a rotation is simulated by swapping keys.
 */
describe("hashStoredApiKeys", () => {
  const RAW = "vr_live_" + "e".repeat(64);
  const digest = (raw: string) =>
    createHash("sha256")
      .update("vulnradar-api-key-digest:" + raw, "utf8")
      .digest("hex");

  function apiKeyWrites() {
    return updates().filter((q) => q.sql.includes("UPDATE api_keys"));
  }

  it("rewrites a 3.9.1 row as the digest, with the ciphertext and locator dropped", async () => {
    const ciphertext = encryptApiKey(RAW);
    apiKeyRows = [{ id: 11, key_encrypted: ciphertext }];

    const stats = await hashStoredApiKeys();

    expect(stats).toEqual({ scanned: 1, hashed: 1, unreadable: 0 });
    const [write] = apiKeyWrites();
    expect(write.sql).toMatch(/key_hash = \$1/);
    expect(write.sql).toMatch(/key_encrypted = NULL/);
    expect(write.sql).toMatch(/key_locator = NULL/);
    // Guarded on the ciphertext it read, so a rotation of this key between
    // the read and the write is not overwritten.
    expect(write.sql).toMatch(/WHERE id = \$2 AND key_encrypted = \$3/);
    expect(write.params).toEqual([digest(RAW), 11, ciphertext]);
  });

  it("opens a row written under the previous encryption key", async () => {
    const underA = encryptApiKey(RAW);
    process.env.API_KEY_ENCRYPTION_KEY = KEY_B;
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = KEY_A;
    apiKeyRows = [{ id: 12, key_encrypted: underA }];

    const stats = await hashStoredApiKeys();

    expect(stats.hashed).toBe(1);
    expect(apiKeyWrites()[0].params).toEqual([digest(RAW), 12, underA]);
  });

  it("leaves a row neither key opens untouched and reports only the count", async () => {
    const underA = encryptApiKey(RAW);
    process.env.API_KEY_ENCRYPTION_KEY = KEY_B;
    apiKeyRows = [
      { id: 13, key_encrypted: underA },
      { id: 14, key_encrypted: encryptApiKey(RAW + "x") },
    ];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const stats = await hashStoredApiKeys();

    expect(stats).toEqual({ scanned: 2, hashed: 1, unreadable: 1 });
    expect(apiKeyWrites()).toHaveLength(1);
    expect(apiKeyWrites()[0].params[1]).toBe(14);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = String(errorSpy.mock.calls[0][0]);
    expect(line).toContain("1 stored API key");
    // A count, not the row, the key or its ciphertext.
    expect(line).not.toContain(underA);
    expect(line).not.toContain("13");
  });

  it("reads only rows that still hold ciphertext, so a second run writes nothing", async () => {
    await hashStoredApiKeys();

    const read = queries.find((q) =>
      q.sql.includes("SELECT id, key_encrypted FROM api_keys"),
    );
    expect(read?.sql).toContain("WHERE key_encrypted IS NOT NULL");
    expect(apiKeyWrites()).toHaveLength(0);
  });

  it("runs as part of the boot backfill", async () => {
    apiKeyRows = [{ id: 15, key_encrypted: encryptApiKey(RAW) }];
    vi.spyOn(console, "log").mockImplementation(() => {});

    const stats = await migratePlaintextSecretsToEncrypted();

    expect(stats.apiKeysHashed).toBe(1);
    expect(apiKeyWrites()).toHaveLength(1);
  });
});
