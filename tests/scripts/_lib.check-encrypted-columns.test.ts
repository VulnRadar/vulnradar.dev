import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptApiKey } from "@/lib/auth/crypto";
import { diagnose } from "../../scripts/_lib/_lib.check-encrypted-columns.mjs";
import { computeApiKeyLocatorMirror } from "../../scripts/_lib/_lib.api-key-locator-mirror.mjs";
import { makeQueryRouterPool, containsAll } from "./_query-router-mock";

const KEY_HEX = randomBytes(32).toString("hex");
const KEY_BUF = Buffer.from(KEY_HEX, "hex");
const originalKey = process.env.API_KEY_ENCRYPTION_KEY;
beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_KEY = KEY_HEX;
});
afterAll(() => {
  if (originalKey === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
  else process.env.API_KEY_ENCRYPTION_KEY = originalKey;
});

function ctxWith(
  tables: string[],
  columnsDetailed: Record<string, Array<{ name: string }>>,
) {
  return {
    tables: new Set(tables),
    columnsDetailed,
    primaryKeys: {},
    foreignKeys: [],
    checkConstraintEnums: [],
  };
}

describe("encrypted-columns: api_keys.key_encrypted", () => {
  const ctx = ctxWith(["api_keys"], {
    api_keys: [
      { name: "id" },
      { name: "key_encrypted" },
      { name: "key_locator" },
    ],
  });

  it("flags a row that fails to decrypt outright", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "api_keys"'),
        handler: () => ({
          rows: [
            {
              id: 1,
              key_encrypted: "not-valid-ciphertext",
              key_locator: "deadbeef",
            },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("auto-fixable");
    expect(findings[0].repair?.sql).toContain(
      "revoked_at = COALESCE(revoked_at, NOW())",
    );
    expect(findings[0].repair?.sql).toContain("IN (1)");
  });

  it("flags a row that decrypts cleanly but whose locator doesn't match (double-encryption-style corruption)", async () => {
    const rawKey = "vr_live_realkeyvalue";
    const encrypted = encryptApiKey(rawKey);
    const wrongLocator = "ffffffff"; // does not equal computeApiKeyLocatorMirror(rawKey, KEY_BUF)
    const realLocator = computeApiKeyLocatorMirror(rawKey, KEY_BUF);
    expect(wrongLocator).not.toBe(realLocator);

    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "api_keys"'),
        handler: () => ({
          rows: [
            { id: 2, key_encrypted: encrypted, key_locator: wrongLocator },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("auto-fixable");
    expect(findings[0].examples[0].pk).toBe(2);
  });

  it("does not flag a row that decrypts cleanly and matches its locator", async () => {
    const rawKey = "vr_live_realkeyvalue";
    const encrypted = encryptApiKey(rawKey);
    const realLocator = computeApiKeyLocatorMirror(rawKey, KEY_BUF);

    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "api_keys"'),
        handler: () => ({
          rows: [{ id: 3, key_encrypted: encrypted, key_locator: realLocator }],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
  });

  it("skips the whole check gracefully when the table doesn't exist on this schema", async () => {
    const pool = makeQueryRouterPool([]); // any call is a bug
    const { findings } = await diagnose(pool, ctxWith([], {}));
    expect(findings).toHaveLength(0);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe("encrypted-columns: discord_connections (paired columns)", () => {
  const ctx = ctxWith(["discord_connections"], {
    discord_connections: [
      { name: "id" },
      { name: "access_token" },
      { name: "refresh_token" },
    ],
  });

  it("reports ONE finding for the whole row when either token fails to decrypt, repaired via delete_row", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "discord_connections"'),
        handler: () => ({
          rows: [
            { id: 9, access_token: "garbage", refresh_token: "also-garbage" },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("auto-fixable");
    expect(findings[0].repair?.sql).toContain(
      'DELETE FROM "discord_connections"',
    );
    expect(findings[0].repair?.sql).toContain("IN (9)");
  });

  it("does not flag a row where both tokens decrypt fine", async () => {
    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "discord_connections"'),
        handler: () => ({
          rows: [
            {
              id: 10,
              access_token: encryptApiKey("access-token-value"),
              refresh_token: encryptApiKey("refresh-token-value"),
            },
          ],
        }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(0);
  });
});

describe("encrypted-columns: user_ai_configs.api_key_encrypted (clear_column)", () => {
  it("clears the column without touching anything else", async () => {
    const ctx = ctxWith(["user_ai_configs"], {
      user_ai_configs: [{ name: "id" }, { name: "api_key_encrypted" }],
    });
    const pool = makeQueryRouterPool([
      {
        match: containsAll('FROM "user_ai_configs"'),
        handler: () => ({ rows: [{ id: 4, api_key_encrypted: "garbage" }] }),
      },
    ]);
    const { findings } = await diagnose(pool, ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].repair?.sql).toBe(
      'UPDATE "user_ai_configs" SET "api_key_encrypted" = NULL WHERE "id" IN (4)',
    );
  });
});

describe("encrypted-columns: encryption not configured", () => {
  it("reports a needs-human 'could not check' finding instead of guessing", async () => {
    const saved = process.env.API_KEY_ENCRYPTION_KEY;
    delete process.env.API_KEY_ENCRYPTION_KEY;
    try {
      const ctx = ctxWith(["api_keys"], {
        api_keys: [
          { name: "id" },
          { name: "key_encrypted" },
          { name: "key_locator" },
        ],
      });
      const pool = makeQueryRouterPool([]); // must not query row data without a key
      const { findings } = await diagnose(pool, ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe("needs-human");
      expect(findings[0].description).toContain(
        "API_KEY_ENCRYPTION_KEY is not configured",
      );
      expect(pool.query).not.toHaveBeenCalled();
    } finally {
      process.env.API_KEY_ENCRYPTION_KEY = saved;
    }
  });
});
