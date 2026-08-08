import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { computeApiKeyLocatorMirror } from "../../scripts/_lib/_lib.api-key-locator-mirror.mjs";

/**
 * lib/api/api-keys.ts's computeKeyLocator() is a private (non-exported)
 * function, so it can't be imported directly for a cross-check the way
 * the 2FA tool's mirrors cross-check exported functions. Instead, this
 * drives it INDIRECTLY through the real, exported generateApiKey(): it
 * always calls computeKeyLocator() internally and passes the result as
 * the `key_locator` INSERT parameter, which this test captures via the
 * mocked pool and compares against this mirror's own computation of the
 * same raw key. If lib/api/api-keys.ts's algorithm ever changes, this
 * mismatches and fails.
 */

const KEY_HEX = randomBytes(32).toString("hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

const insertCalls: { sql: string; params: unknown[] }[] = [];
const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (sql.includes("INSERT INTO api_keys")) {
    insertCalls.push({ sql, params });
    return {
      rows: [
        {
          id: 1,
          key_prefix: "vr_live_abc",
          name: "test",
          daily_limit: 50,
          created_at: new Date(),
        },
      ],
    };
  }
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const { generateApiKey } = await import("@/lib/api/api-keys");

describe("computeApiKeyLocatorMirror matches the real computeKeyLocator", () => {
  it("matches the key_locator generateApiKey() actually persists", async () => {
    const result = await generateApiKey(1, "Test Key");
    expect(insertCalls).toHaveLength(1);

    // INSERT INTO api_keys (user_id, key_hash, key_locator, key_prefix, name, daily_limit, key_encrypted)
    const persistedLocator = insertCalls[0].params[2] as string;
    expect(typeof persistedLocator).toBe("string");

    const key = Buffer.from(KEY_HEX, "hex");
    const mirrored = computeApiKeyLocatorMirror(result.raw_key, key);
    expect(mirrored).toBe(persistedLocator);
  });

  it("produces an 8-hex-char locator, matching the real format", async () => {
    const result = await generateApiKey(2, "Another Key");
    const key = Buffer.from(KEY_HEX, "hex");
    const mirrored = computeApiKeyLocatorMirror(result.raw_key, key);
    expect(mirrored).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is deterministic for the same key and raw value", () => {
    const key = Buffer.from(KEY_HEX, "hex");
    const raw = "vr_live_deadbeefdeadbeefdeadbeefdeadbeef";
    expect(computeApiKeyLocatorMirror(raw, key)).toBe(
      computeApiKeyLocatorMirror(raw, key),
    );
  });

  it("differs for a different key (proves it's actually keyed, not a plain hash)", () => {
    const raw = "vr_live_deadbeefdeadbeefdeadbeefdeadbeef";
    const keyA = Buffer.from(KEY_HEX, "hex");
    const keyB = randomBytes(32);
    expect(computeApiKeyLocatorMirror(raw, keyA)).not.toBe(
      computeApiKeyLocatorMirror(raw, keyB),
    );
  });
});
