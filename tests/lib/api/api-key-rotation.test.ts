import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import { createHmac } from "node:crypto";

/**
 * validateApiKey across a rotation of API_KEY_ENCRYPTION_KEY.
 *
 * A key's locator is an HMAC under that encryption key, so rotating it (the
 * procedure crypto.ts documents) changed what every key's locator SHOULD be
 * while every stored row kept the old one. The lookup by the new locator came
 * back empty and every API key answered 401 with nothing logged.
 *
 * Crypto is real here, because the property under test is that a value written
 * under one key is found and rewritten under another. The pool is a small
 * in-memory fake that answers the two statements involved the way PostgreSQL
 * would for one table; whether the real UPDATE behaves is proven in
 * tests/integration/api-key-locator-migration.test.ts.
 */

const OLD_KEY = "b".repeat(64);
const NEW_KEY = "c".repeat(64);
const RAW = "vr_live_rot00000000000000000000000000000000000000000000000000000";

interface StoredRow {
  key_id: number;
  user_id: number;
  name: string;
  revoked_at: string | null;
  key_encrypted: string;
  key_locator: string;
  bound_ip: string | null;
  scopes: unknown;
  email: string;
  user_name: string;
  tos_accepted_at: string | null;
  disabled_at: string | null;
}

let rows: StoredRow[] = [];
const queries: { sql: string; params: unknown[] }[] = [];
let afterLocatorSelect: ((locator: string) => void) | null = null;
let failUpdate = false;

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.trim();
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: [] };
  }
  if (
    s.startsWith("SELECT ak.id as key_id") &&
    s.includes("ak.key_locator = $1")
  ) {
    const found = rows
      .filter((r) => r.key_locator === params[0])
      .map((r) => ({ ...r }));
    afterLocatorSelect?.(params[0] as string);
    return { rows: found };
  }
  if (s.startsWith("UPDATE api_keys") && s.includes("SET key_locator = $1")) {
    if (failUpdate) throw new Error("connection terminated");
    const [locator, encrypted, id, oldLocator, oldEncrypted] = params;
    const row = rows.find(
      (r) =>
        r.key_id === id &&
        r.key_locator === oldLocator &&
        r.key_encrypted === oldEncrypted,
    );
    if (!row) return { rows: [], rowCount: 0 };
    row.key_locator = locator as string;
    row.key_encrypted = encrypted as string;
    return { rows: [], rowCount: 1 };
  }
  if (s.startsWith("SELECT EXISTS")) return { rows: [{ present: false }] };
  return { rows: [] };
});

vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => {}),
}));

const { validateApiKey, __resetLegacyKeyRowCache } =
  await import("@/lib/api/api-keys");
const { encryptApiKey, decryptApiKey } = await import("@/lib/auth/crypto");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

function locatorUnder(hexKey: string, rawKey = RAW): string {
  return createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(rawKey)
    .digest("hex")
    .slice(0, 8);
}

/** A row exactly as generateApiKey wrote it while `hexKey` was the current key. */
function rowWrittenUnder(
  hexKey: string,
  keyId: number,
  overrides: Partial<StoredRow> = {},
): StoredRow {
  const saved = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = hexKey;
  try {
    // encryptApiKey reads the current key at call time, so this ciphertext is
    // genuinely under `hexKey`.
    return {
      key_id: keyId,
      user_id: 3,
      name: "CI key",
      revoked_at: null,
      key_encrypted: encryptApiKey(RAW),
      key_locator: locatorUnder(hexKey),
      bound_ip: null,
      scopes: null,
      email: "owner@example.com",
      user_name: "Owner",
      tos_accepted_at: new Date().toISOString(),
      disabled_at: null,
      ...overrides,
    };
  } finally {
    restoreEnv("API_KEY_ENCRYPTION_KEY", saved);
  }
}

/** The operator's rotation: new key current, old key kept as the previous one. */
function rotate() {
  process.env.API_KEY_ENCRYPTION_KEY = NEW_KEY;
  process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = OLD_KEY;
}

function locatorLookups() {
  return queries.filter((q) => q.sql.includes("ak.key_locator = $1"));
}

let errorSpy: MockInstance<typeof console.error>;
const savedEnv = {
  current: process.env.API_KEY_ENCRYPTION_KEY,
  previous: process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY,
};

beforeEach(() => {
  rows = [];
  queries.length = 0;
  afterLocatorSelect = null;
  failUpdate = false;
  mockQuery.mockClear();
  process.env.API_KEY_ENCRYPTION_KEY = NEW_KEY;
  delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  __resetLegacyKeyRowCache();
  invalidateSettingsCache();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Assigning undefined to process.env stores the string "undefined". */
function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
  restoreEnv("API_KEY_ENCRYPTION_KEY", savedEnv.current);
  restoreEnv("PREVIOUS_API_KEY_ENCRYPTION_KEY", savedEnv.previous);
});

describe("validateApiKey after API_KEY_ENCRYPTION_KEY was rotated", () => {
  it("rejects the key when the old key is not kept as the previous one (the failure being fixed)", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    process.env.API_KEY_ENCRYPTION_KEY = NEW_KEY;

    expect(await validateApiKey(RAW)).toBeNull();
  });

  it("finds a key by the previous key's locator and accepts it", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    rotate();

    const result = await validateApiKey(RAW);

    expect(result?.keyId).toBe(1);
    expect(result?.userId).toBe(3);
  });

  it("rewrites the locator and the ciphertext under the current key", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    const oldCiphertext = rows[0].key_encrypted;
    rotate();

    await validateApiKey(RAW);

    expect(rows[0].key_locator).toBe(locatorUnder(NEW_KEY));
    expect(rows[0].key_encrypted).not.toBe(oldCiphertext);
    // Readable with the previous key removed: the ciphertext really moved.
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    expect(decryptApiKey(rows[0].key_encrypted)).toBe(RAW);
  });

  it("keeps working once the previous key is removed, which is the point of the rewrite", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    rotate();
    await validateApiKey(RAW);

    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;

    expect((await validateApiKey(RAW))?.keyId).toBe(1);
  });

  it("pays the extra lookup only once per key: a migrated key hits the current locator", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    rotate();
    expect((await validateApiKey(RAW))?.keyId).toBe(1);
    queries.length = 0;

    expect((await validateApiKey(RAW))?.keyId).toBe(1);

    expect(locatorLookups()).toHaveLength(1);
    expect(locatorLookups()[0].params).toEqual([locatorUnder(NEW_KEY)]);
  });

  it("rejects a key that matches neither locator, and rewrites nothing", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    const before = { ...rows[0] };
    rotate();

    expect(await validateApiKey("vr_live_not_a_real_key")).toBeNull();
    expect(rows[0]).toEqual(before);
  });

  it("does not look anything up under a previous locator when no previous key is set", async () => {
    rows = [];

    await validateApiKey(RAW);

    expect(locatorLookups()).toHaveLength(1);
  });

  it("ignores a malformed previous key rather than computing a locator from it", async () => {
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = "not-hex";

    await validateApiKey(RAW);

    expect(locatorLookups()).toHaveLength(1);
  });

  it("does not repeat the lookup when the previous key equals the current one", async () => {
    process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = NEW_KEY;

    await validateApiKey(RAW);

    expect(locatorLookups()).toHaveLength(1);
  });

  it("still enforces revocation on a key found through the previous locator", async () => {
    rows = [
      rowWrittenUnder(OLD_KEY, 1, { revoked_at: "2026-01-01T00:00:00Z" }),
    ];
    rotate();

    expect(await validateApiKey(RAW)).toBeNull();
    // Rejected, but only after the row was found through the previous locator.
    expect(rows[0].key_locator).toBe(locatorUnder(NEW_KEY));
  });

  it("still enforces a suspended account on a key found through the previous locator", async () => {
    rows = [
      rowWrittenUnder(OLD_KEY, 1, { disabled_at: "2026-01-01T00:00:00Z" }),
    ];
    rotate();

    expect(await validateApiKey(RAW)).toBeNull();
    expect(rows[0].key_locator).toBe(locatorUnder(NEW_KEY));
  });

  it("does not overwrite a key that was rotated by its owner between the read and the write", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 1)];
    rotate();
    // The owner rotates this key (new secret, new locator) just after the
    // SELECT returned it. The UPDATE's WHERE must notice and write nothing.
    afterLocatorSelect = (locator) => {
      if (locator === locatorUnder(OLD_KEY)) {
        rows[0].key_locator = "ffffffff";
        rows[0].key_encrypted = "rotated-ciphertext";
      }
    };

    const result = await validateApiKey(RAW);

    // The request that read the old row was authenticated with a valid key.
    expect(result?.keyId).toBe(1);
    expect(rows[0].key_locator).toBe("ffffffff");
    expect(rows[0].key_encrypted).toBe("rotated-ciphertext");
  });

  it("lets the request through and logs when the rewrite fails, so the next request retries", async () => {
    rows = [rowWrittenUnder(OLD_KEY, 7)];
    rotate();
    failUpdate = true;

    const result = await validateApiKey(RAW);

    expect(result?.keyId).toBe(7);
    const [message, ctx, err] = errorSpy.mock.calls[0];
    expect(message).toBe(
      "[api-keys] could not move an API key onto the current encryption key",
    );
    expect(ctx).toEqual({ keyId: 7 });
    expect(err).toBeInstanceOf(Error);
    // Unchanged, so the next request still finds it by the previous locator.
    expect(rows[0].key_locator).toBe(locatorUnder(OLD_KEY));
  });
});

describe("validateApiKey: a stored key that cannot be decrypted", () => {
  it("is reported with its key id and the Error, so the row keeps a stack", async () => {
    rows = [
      {
        ...rowWrittenUnder(NEW_KEY, 4101),
        key_encrypted: Buffer.from("not a real ciphertext at all").toString(
          "base64",
        ),
      },
    ];

    const result = await validateApiKey(RAW);

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message, ctx, err] = errorSpy.mock.calls[0];
    expect(message).toBe(
      "[api-keys] stored API key could not be decrypted under the current or previous encryption key",
    );
    expect(ctx).toEqual({ keyId: 4101 });
    expect(err).toBeInstanceOf(Error);
  });

  it("is reported once per process, however often the key is presented", async () => {
    rows = [
      {
        ...rowWrittenUnder(NEW_KEY, 4102),
        key_encrypted: Buffer.from(
          "garbage garbage garbage garbage!!",
        ).toString("base64"),
      },
    ];

    await validateApiKey(RAW);
    await validateApiKey(RAW);
    await validateApiKey(RAW);

    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("does not report a row that decrypts fine but belongs to a different key", async () => {
    // A locator is only 8 hex characters, so two keys can share one. The row
    // opens, holds another key, and is simply not a match: nothing is wrong.
    const other = RAW + "x";
    rows = [
      {
        ...rowWrittenUnder(NEW_KEY, 4103),
        key_locator: locatorUnder(NEW_KEY, other),
      },
    ];

    expect(await validateApiKey(other)).toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
