/**
 * Tests for lib/webhooks/secret.ts (AUDIT-009#webhook-01: webhooks.secret
 * was the only long-lived reversible secret still stored in plaintext).
 *
 * The important cases are the ones that are easy to get wrong in a
 * roundtrip like this: a legacy plaintext row must keep working (it is 64
 * hex characters, which is ALSO decodable as base64, so a naive
 * "does it look like ciphertext" check silently drops it), and a value that
 * is ciphertext under a key we no longer hold must never be re-encrypted or
 * signed with.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  encryptWebhookSecret,
  readWebhookSecret,
  migratePlaintextWebhookSecrets,
  encryptWebhookUrl,
  readWebhookHost,
  readWebhookUrl,
  storeWebhookUrl,
} = await import("@/lib/webhooks/secret");
const { encryptApiKey } = await import("@/lib/auth/crypto");

const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const PLAINTEXT = "f".repeat(64);

let previousKey: string | undefined;

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
  previousKey = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = KEY;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (previousKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = previousKey;
  vi.restoreAllMocks();
});

describe("encryptWebhookSecret / readWebhookSecret", () => {
  it("round-trips a generated secret through ciphertext", () => {
    const stored = encryptWebhookSecret(PLAINTEXT);
    expect(stored).not.toBe(PLAINTEXT);
    expect(readWebhookSecret(stored)).toBe(PLAINTEXT);
  });

  it("stores plaintext when no encryption key is configured, and still reads it back", () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    const stored = encryptWebhookSecret(PLAINTEXT);
    expect(stored).toBe(PLAINTEXT);
    expect(readWebhookSecret(stored)).toBe(PLAINTEXT);
  });

  it("refuses to store plaintext when the key is set but malformed", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encryptWebhookSecret(PLAINTEXT)).toThrow(
      "API_KEY_ENCRYPTION_KEY",
    );
  });

  it("reads a legacy 64-hex plaintext row unchanged", () => {
    // 64 hex chars decode as 48 base64 bytes, which is longer than the
    // 29-byte iv+tag floor, so this is precisely the value a shape check
    // alone would misclassify as ciphertext and throw away.
    expect(readWebhookSecret(PLAINTEXT)).toBe(PLAINTEXT);
  });

  it("reads a legacy row that is neither hex nor ciphertext-shaped", () => {
    expect(readWebhookSecret("test-secret-abc123")).toBe("test-secret-abc123");
  });

  it("returns null for null, so a legacy unsigned webhook stays unsigned", () => {
    expect(readWebhookSecret(null)).toBeNull();
    expect(readWebhookSecret("")).toBeNull();
  });

  it("returns null (not the ciphertext) when the value does not decrypt under the current key", () => {
    const stored = encryptWebhookSecret(PLAINTEXT);
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    // Signing with the raw ciphertext would produce a signature no receiver
    // can verify while looking like delivery worked.
    expect(readWebhookSecret(stored)).toBeNull();
  });

  it("reads a value encrypted under the previous key during a rotation", () => {
    const stored = encryptWebhookSecret(PLAINTEXT);
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = KEY;
    try {
      expect(readWebhookSecret(stored)).toBe(PLAINTEXT);
    } finally {
      delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    }
  });
});

describe("migratePlaintextWebhookSecrets", () => {
  it("encrypts every plaintext row in place and leaves already-encrypted rows alone", async () => {
    const alreadyEncrypted = encryptApiKey("c".repeat(64));
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, secret: PLAINTEXT },
        { id: 2, secret: alreadyEncrypted },
        { id: 3, secret: "legacy-hand-inserted" },
      ],
    });

    const stats = await migratePlaintextWebhookSecrets();

    expect(stats).toEqual({
      scanned: 3,
      encrypted: 2,
      alreadyEncrypted: 1,
      unreadable: 0,
      urlsEncrypted: 0,
    });

    const updates = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE webhooks SET secret"),
    );
    expect(updates).toHaveLength(2);
    expect(updates.map((c) => c[1][1])).toEqual([1, 3]);
    expect(readWebhookSecret(updates[0][1][0] as string)).toBe(PLAINTEXT);
  });

  it("never rewrites a row that is ciphertext under a key we no longer hold", async () => {
    const foreign = encryptApiKey(PLAINTEXT);
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 9, secret: foreign }] });

    const stats = await migratePlaintextWebhookSecrets();

    expect(stats.unreadable).toBe(1);
    expect(stats.encrypted).toBe(0);
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).startsWith("UPDATE webhooks"),
      ),
    ).toBe(false);
  });

  it("does nothing at all when no encryption key is configured", async () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    const stats = await migratePlaintextWebhookSecrets();
    expect(stats.scanned).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// enc-2: a Discord or Slack webhook URL is the credential for posting into
// that channel, so it is held the way the signing secret beside it is.
const DISCORD_URL = "https://discord.com/api/webhooks/123/s3cr3t-token";

describe("storeWebhookUrl / readWebhookUrl", () => {
  it("stores ciphertext and an empty url column, with the host beside it", () => {
    const stored = storeWebhookUrl(DISCORD_URL);
    expect(stored.url).toBe("");
    expect(stored.urlHost).toBe("discord.com");
    expect(stored.urlEncrypted).not.toBeNull();
    expect(stored.urlEncrypted).not.toContain("s3cr3t-token");
    expect(encryptWebhookUrl(DISCORD_URL)).not.toBe(DISCORD_URL);
    expect(
      readWebhookUrl({
        id: 1,
        url: stored.url,
        url_encrypted: stored.urlEncrypted,
      }),
    ).toBe(DISCORD_URL);
  });

  it("keeps the url column when no encryption key is configured", () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    const stored = storeWebhookUrl(DISCORD_URL);
    expect(stored).toEqual({
      url: DISCORD_URL,
      urlEncrypted: null,
      urlHost: "discord.com",
    });
    expect(
      readWebhookUrl({ id: 1, url: stored.url, url_encrypted: null }),
    ).toBe(DISCORD_URL);
  });

  it("refuses to store the URL in the clear when the key is set but malformed", () => {
    process.env.API_KEY_ENCRYPTION_KEY = "z".repeat(64);
    expect(() => storeWebhookUrl(DISCORD_URL)).toThrow(
      "API_KEY_ENCRYPTION_KEY",
    );
  });

  it("reads a legacy row that still has only the plaintext column", () => {
    expect(
      readWebhookUrl({ id: 1, url: DISCORD_URL, url_encrypted: null }),
    ).toBe(DISCORD_URL);
  });

  it("returns null for a row with no address at all", () => {
    expect(readWebhookUrl({ id: 1, url: "", url_encrypted: null })).toBeNull();
  });

  it("reads an address written to url after the row was encrypted, not the older ciphertext", () => {
    // What a 3.9.1 binary leaves when it edits a moved row during a rollback
    // or a rolling deploy: it writes url and knows nothing of url_encrypted.
    const old = storeWebhookUrl(DISCORD_URL);
    const newer = "https://hooks.slack.com/services/T0/B0/newer-token";

    expect(
      readWebhookUrl({ id: 1, url: newer, url_encrypted: old.urlEncrypted }),
    ).toBe(newer);
    expect(readWebhookHost({ url: newer, url_host: old.urlHost })).toBe(
      "hooks.slack.com",
    );
  });

  it("reads the host from its column once url is emptied", () => {
    expect(readWebhookHost({ url: "", url_host: "discord.com" })).toBe(
      "discord.com",
    );
    expect(readWebhookHost({ url: "", url_host: null })).toBeNull();
  });

  it("opens a value written under the previous key during a rotation", () => {
    const { urlEncrypted } = storeWebhookUrl(DISCORD_URL);
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = KEY;
    try {
      expect(
        readWebhookUrl({ id: 1, url: "", url_encrypted: urlEncrypted }),
      ).toBe(DISCORD_URL);
    } finally {
      delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    }
  });

  it("returns null for ciphertext that does not open, and logs the id but never the value", () => {
    const { urlEncrypted } = storeWebhookUrl(DISCORD_URL);
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    const errors = vi.mocked(console.error);

    expect(
      readWebhookUrl({ id: 77, url: "", url_encrypted: urlEncrypted }),
    ).toBeNull();

    const logged = errors.mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("77");
    expect(logged).not.toContain(String(urlEncrypted));
    expect(logged).not.toContain("s3cr3t-token");
  });
});

describe("migratePlaintextWebhookSecrets: webhook URLs", () => {
  function routeUrlRows(rows: { id: number; url: string }[]) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, url FROM webhooks")) return { rows };
      if (sql.startsWith("UPDATE webhooks SET url_encrypted")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    });
  }

  it("moves every plaintext URL into the encrypted column and empties url", async () => {
    routeUrlRows([{ id: 5, url: DISCORD_URL }]);

    const stats = await migratePlaintextWebhookSecrets();

    expect(stats.urlsEncrypted).toBe(1);
    const select = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT id, url FROM webhooks"),
    );
    // Every non-empty url, including one beside an older ciphertext, which a
    // url_encrypted IS NULL filter would leave in the clear for good.
    expect(select?.[0]).toContain("url <> ''");
    expect(select?.[0]).not.toContain("url_encrypted IS NULL");

    const update = mockQuery.mock.calls.find(([sql]) =>
      String(sql).startsWith("UPDATE webhooks SET url_encrypted"),
    );
    expect(update).toBeDefined();
    const [sql, params] = update as [string, unknown[]];
    expect(sql).toContain("url = ''");
    // Guarded on the value it read, so an edit that lands between the
    // SELECT and this UPDATE is not overwritten with the older address.
    expect(sql).toContain("WHERE id = $1 AND url = $4");
    expect(params[0]).toBe(5);
    expect(params[2]).toBe("discord.com");
    expect(params[3]).toBe(DISCORD_URL);
    expect(params[1]).not.toBe(DISCORD_URL);
    expect(
      readWebhookUrl({ id: 5, url: "", url_encrypted: params[1] as string }),
    ).toBe(DISCORD_URL);
  });

  it("does not count a row whose guarded UPDATE matched nothing", async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT id, url FROM webhooks")) {
        return { rows: [{ id: 5, url: DISCORD_URL }] };
      }
      return { rows: [], rowCount: 0 };
    });

    const stats = await migratePlaintextWebhookSecrets();

    expect(stats.urlsEncrypted).toBe(0);
  });

  it("leaves URLs in place when no encryption key is configured", async () => {
    delete process.env.API_KEY_ENCRYPTION_KEY;
    routeUrlRows([{ id: 5, url: DISCORD_URL }]);

    const stats = await migratePlaintextWebhookSecrets();

    expect(stats.urlsEncrypted).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
