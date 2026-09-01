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
