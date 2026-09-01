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

type Row = Record<string, unknown>;

const queries: { sql: string; params: unknown[] }[] = [];
let totpRows: Row[] = [];
let discordRows: Row[] = [];

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT id, totp_secret")) return { rows: totpRows };
  if (s.startsWith("SELECT user_id, access_token"))
    return { rows: discordRows };
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { migratePlaintextSecretsToEncrypted } =
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
  process.env.API_KEY_ENCRYPTION_KEY = KEY_A;
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
