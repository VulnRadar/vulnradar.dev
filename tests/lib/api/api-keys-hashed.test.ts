import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac, hash } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * API keys are stored as a SHA-256 digest, never as ciphertext.
 *
 * Until 4.0.0 the key went into api_keys.key_encrypted under AES and every
 * request decrypted it to compare. Nothing ever showed a key again after it
 * was created, so the reversible copy had no reader except validation, and
 * anyone holding the database and API_KEY_ENCRYPTION_KEY together held every
 * customer's working key. It also tied whether a key worked to the encryption
 * key: drop the previous key after a rotation and an unused integration
 * answered 401.
 *
 * Crypto is real and spied on, because "validation never opens a ciphertext"
 * is a claim about calls that did not happen. The pool is a small in-memory
 * table that answers the statements the module sends the way PostgreSQL would
 * for one table; tests/integration/api-key-hash-migration.test.ts proves the
 * same against a real database.
 */

const CURRENT_KEY = "c".repeat(64);
const OTHER_KEY = "d".repeat(64);

interface StoredRow {
  id: number;
  user_id: number;
  name: string;
  key_hash: string;
  key_locator: string | null;
  key_encrypted: string | null;
  key_prefix: string;
  daily_limit: number;
  scopes: string | null;
  revoked_at: string | null;
  bound_ip: string | null;
  created_at: Date;
}

let table: StoredRow[] = [];
let nextId = 1;
const queries: { sql: string; params: unknown[] }[] = [];

const OWNER = {
  email: "owner@example.com",
  user_name: "Owner",
  tos_accepted_at: new Date().toISOString(),
  disabled_at: null,
  plan: "free",
  role: "user",
  gifted_plan: null,
};

function joined(row: StoredRow) {
  return { ...row, key_id: row.id, ...OWNER };
}

/** The bcrypt-row predicate, honouring each condition the SQL states. */
function isBcryptRow(sql: string, row: StoredRow): boolean {
  if (!row.key_hash.startsWith("$2")) return false;
  if (sql.includes("key_encrypted IS NULL") && row.key_encrypted) return false;
  if (sql.includes("key_locator IS NULL") && row.key_locator) return false;
  return true;
}

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  queries.push({ sql, params });
  const s = sql.replace(/\s+/g, " ").trim();

  if (s.startsWith("INSERT INTO api_keys")) {
    const [userId, keyHash, locator, prefix, name, limit, encrypted, scopes] =
      params;
    const row: StoredRow = {
      id: nextId++,
      user_id: userId as number,
      name: name as string,
      key_hash: keyHash as string,
      key_locator: (locator as string | null) ?? null,
      key_encrypted: (encrypted as string | null) ?? null,
      key_prefix: prefix as string,
      daily_limit: limit as number,
      scopes: scopes as string,
      revoked_at: null,
      bound_ip: null,
      created_at: new Date(),
    };
    table.push(row);
    return { rows: [{ ...row }], rowCount: 1 };
  }

  if (s.startsWith("SELECT daily_limit, scopes FROM api_keys")) {
    const row = table.find((r) => r.id === params[0]);
    return { rows: row ? [{ ...row }] : [] };
  }

  if (
    s.startsWith("UPDATE api_keys SET key_hash") &&
    s.includes("WHERE id = $2 AND key_hash = $3")
  ) {
    // The legacy bcrypt rewrite, guarded on the hash it read.
    const row = table.find(
      (r) => r.id === params[1] && r.key_hash === params[2],
    );
    if (!row) return { rows: [], rowCount: 0 };
    row.key_hash = params[0] as string;
    row.key_locator = null;
    return { rows: [], rowCount: 1 };
  }

  if (s.startsWith("UPDATE api_keys SET key_hash")) {
    // rotateApiKey: the last two parameters are always id and user_id.
    const [id, userId] = params.slice(-2);
    const row = table.find((r) => r.id === id && r.user_id === userId);
    if (!row) return { rows: [], rowCount: 0 };
    row.key_hash = params[0] as string;
    row.key_locator = s.includes("key_locator = NULL")
      ? null
      : (params[1] as string);
    row.key_encrypted = s.includes("key_encrypted = NULL")
      ? null
      : (params[3] as string);
    row.bound_ip = null;
    return { rows: [{ ...row }], rowCount: 1 };
  }

  if (s.startsWith("SELECT ak.id as key_id")) {
    if (s.includes("ak.key_hash = $1")) {
      return {
        rows: table.filter((r) => r.key_hash === params[0]).map(joined),
      };
    }
    // The 3.9.1 lookup, answered faithfully so the base fails for the reason
    // under test and not because this fake did not understand it.
    if (s.includes("ak.key_locator = $1")) {
      return {
        rows: table
          .filter((r) => r.key_locator === params[0] && r.key_encrypted)
          .map(joined),
      };
    }
    if (s.includes("LIKE '$2%'")) {
      return { rows: table.filter((r) => isBcryptRow(s, r)).map(joined) };
    }
    return { rows: [] };
  }

  if (s.startsWith("SELECT EXISTS")) {
    const present = s.includes("LIKE '$2%'")
      ? table.some((r) => isBcryptRow(s, r))
      : table.some((r) => r.key_locator === null);
    return { rows: [{ present }] };
  }

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

vi.mock("@/lib/api/request-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/request-utils")>();
  return {
    ...actual,
    getClientIp: vi.fn(async () => "unknown"),
    getUserAgent: vi.fn(async () => "test"),
  };
});

const decryptCalls = vi.fn();
const encryptCalls = vi.fn();

vi.mock("@/lib/auth/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/crypto")>();
  return {
    ...actual,
    encryptApiKey: (plaintext: string) => {
      encryptCalls(plaintext);
      return actual.encryptApiKey(plaintext);
    },
    decryptApiKey: (value: string) => {
      decryptCalls(value);
      return actual.decryptApiKey(value);
    },
    decryptApiKeyWithKeyAge: (value: string) => {
      decryptCalls(value);
      return actual.decryptApiKeyWithKeyAge(value);
    },
  };
});

const {
  generateApiKey,
  rotateApiKey,
  validateApiKey,
  __resetLegacyKeyRowCache,
} = await import("@/lib/api/api-keys");
const realCrypto =
  await vi.importActual<typeof import("@/lib/auth/crypto")>(
    "@/lib/auth/crypto",
  );
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

/**
 * What key_hash holds from 4.0.0 on, written out here rather than imported so
 * a change to the stored form (which invalidates every key) fails this suite.
 */
function storedDigest(raw: string): string {
  return hash("sha256", "vulnradar-api-key-digest:" + raw, "hex");
}

/** What releases before 2.2.0 stored in key_hash: the key's bare SHA-256. */
function bareSha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Whatever a stored value opens to under the deployment's key, or null. */
function opensTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return realCrypto.decryptApiKey(value);
  } catch {
    return null;
  }
}

const saved = {
  current: process.env.API_KEY_ENCRYPTION_KEY,
  previous: process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY,
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  table = [];
  nextId = 1;
  queries.length = 0;
  mockQuery.mockClear();
  decryptCalls.mockClear();
  encryptCalls.mockClear();
  process.env.API_KEY_ENCRYPTION_KEY = CURRENT_KEY;
  delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  __resetLegacyKeyRowCache();
  invalidateSettingsCache();
});

afterEach(() => {
  restoreEnv("API_KEY_ENCRYPTION_KEY", saved.current);
  restoreEnv("PREVIOUS_API_KEY_ENCRYPTION_KEY", saved.previous);
});

async function newKey() {
  const created = await generateApiKey(3, "CI key", 100);
  expect(created).not.toBeNull();
  return { id: created!.id as number, raw: created!.raw_key as string };
}

describe("generateApiKey stores a one-way digest", () => {
  it("keeps the vr_live_ plus 64 hex format the caller sees", async () => {
    const { raw } = await newKey();
    expect(raw).toMatch(/^vr_live_[0-9a-f]{64}$/);
  });

  it("writes the digest to key_hash and nothing reversible anywhere", async () => {
    const { raw } = await newKey();

    const insert = queries.find((q) => q.sql.includes("INSERT INTO api_keys"));
    expect(insert).toBeDefined();
    for (const param of insert!.params) {
      expect(String(param)).not.toContain(raw.slice(8));
      expect(opensTo(param)).toBeNull();
    }
    expect(table[0].key_hash).toBe(storedDigest(raw));
    expect(table[0].key_encrypted).toBeNull();
    expect(table[0].key_locator).toBeNull();
    expect(encryptCalls).not.toHaveBeenCalled();
  });
});

describe("validateApiKey compares digests", () => {
  it("accepts a key it generated", async () => {
    const { id, raw } = await newKey();
    expect((await validateApiKey(raw))?.keyId).toBe(id);
  });

  it("rejects the same key with one character changed", async () => {
    const { raw } = await newKey();
    const last = raw.at(-1) === "0" ? "1" : "0";
    expect(await validateApiKey(raw.slice(0, -1) + last)).toBeNull();
  });

  it("never decrypts anything, for a valid key or an invalid one", async () => {
    const { raw } = await newKey();
    await validateApiKey(raw);
    await validateApiKey("vr_live_" + "0".repeat(64));
    expect(decryptCalls).not.toHaveBeenCalled();
  });

  it("looks the key up by its digest on the unique key_hash column", async () => {
    const { raw } = await newKey();
    queries.length = 0;
    await validateApiKey(raw);
    const lookup = queries.find((q) => q.sql.includes("ak.key_hash = $1"));
    expect(lookup?.params).toEqual([storedDigest(raw)]);
  });

  it("keeps working when API_KEY_ENCRYPTION_KEY is replaced and no previous key is set", async () => {
    const { id, raw } = await newKey();
    process.env.API_KEY_ENCRYPTION_KEY = OTHER_KEY;
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
    expect((await validateApiKey(raw))?.keyId).toBe(id);
  });

  it("does not need API_KEY_ENCRYPTION_KEY at all", async () => {
    const { id, raw } = await newKey();
    delete process.env.API_KEY_ENCRYPTION_KEY;
    expect((await validateApiKey(raw))?.keyId).toBe(id);
  });

  it("does not open a row that still holds 3.9.1 ciphertext", async () => {
    // The boot migration turns these into digests (lib/auth/security-
    // migration.ts). Until it has, validation does not decrypt to compare.
    const raw = "vr_live_" + "a".repeat(64);
    table.push({
      id: 50,
      user_id: 3,
      name: "old",
      key_hash: "deprecated_" + "0".repeat(96),
      key_locator: createHmac("sha256", Buffer.from(CURRENT_KEY, "hex"))
        .update(raw)
        .digest("hex")
        .slice(0, 8),
      key_encrypted: realCrypto.encryptApiKey(raw),
      key_prefix: raw.slice(0, 16),
      daily_limit: 100,
      scopes: null,
      revoked_at: null,
      bound_ip: null,
      created_at: new Date(),
    });

    expect(await validateApiKey(raw)).toBeNull();
    expect(decryptCalls).not.toHaveBeenCalled();
  });

  it("does not bring back a key a release before 2.2.0 stored as its bare SHA-256", async () => {
    // Those releases wrote sha256(raw) into this same column. The keys have
    // answered 401 since bcrypt replaced the bare hash (3.9.1 runs a bcrypt
    // compare on the row, which a hex string never passes), but nothing
    // revoked the rows: a stored digest equal to the bare hash would turn
    // every one of them back on.
    const raw = "vr_live_" + "f".repeat(64);
    table.push({
      id: 60,
      user_id: 3,
      name: "2.1 key",
      key_hash: bareSha256Hex(raw),
      key_locator: null,
      key_encrypted: null,
      key_prefix: raw.slice(0, 16),
      daily_limit: 100,
      scopes: null,
      revoked_at: null,
      bound_ip: null,
      created_at: new Date("2026-02-20T00:00:00Z"),
    });

    expect(await validateApiKey(raw)).toBeNull();
  });
});

describe("rotateApiKey stores the new secret as a digest", () => {
  it("replaces the digest and leaves nothing reversible", async () => {
    const { id, raw } = await newKey();

    const rotated = await rotateApiKey(id, 3);

    expect(rotated?.id).toBe(id);
    const newRaw = rotated!.raw_key as string;
    expect(table[0].key_hash).toBe(storedDigest(newRaw));
    expect(table[0].key_encrypted).toBeNull();
    expect(table[0].key_locator).toBeNull();
    const update = queries.find((q) =>
      q.sql.trim().startsWith("UPDATE api_keys"),
    );
    for (const param of update!.params) {
      expect(String(param)).not.toContain(newRaw.slice(8));
      expect(opensTo(param)).toBeNull();
    }

    expect((await validateApiKey(newRaw))?.keyId).toBe(id);
    expect(await validateApiKey(raw)).toBeNull();
    expect(encryptCalls).not.toHaveBeenCalled();
  });
});

describe("a legacy bcrypt row", () => {
  const RAW = "vr_live_" + "b".repeat(64);

  async function legacyRow(
    overrides: Partial<StoredRow> = {},
  ): Promise<StoredRow> {
    const row: StoredRow = {
      id: 70,
      user_id: 3,
      name: "very old",
      key_hash: await bcrypt.hash(RAW, 4),
      key_locator: null,
      key_encrypted: null,
      key_prefix: RAW.slice(0, 16),
      daily_limit: 100,
      scopes: null,
      revoked_at: null,
      bound_ip: null,
      created_at: new Date(),
      ...overrides,
    };
    table.push(row);
    return row;
  }

  it("refuses the key with bytes past bcrypt's 72 and does not rewrite the row", async () => {
    // bcrypt compares only the first 72 bytes, and RAW is exactly 72, so the
    // key with anything appended passes the compare. Rewriting the row to the
    // digest of that longer string would lock the real key out for good.
    const row = await legacyRow();
    const oldHash = row.key_hash;

    expect(await validateApiKey(RAW + "x")).toBeNull();
    expect(row.key_hash).toBe(oldHash);

    expect((await validateApiKey(RAW))?.keyId).toBe(70);
    expect(row.key_hash).toBe(storedDigest(RAW));
  });

  it("stays refused when it carries a key_locator, as it was in 3.9.1", async () => {
    // 3.9.1 only ran the bcrypt compare on rows with no locator, so a bcrypt
    // row that has one has not authenticated since then either.
    await legacyRow({ key_locator: "0a1b2c3d" });

    expect(await validateApiKey(RAW)).toBeNull();
  });

  it("authenticates and is rewritten to the digest on its first use", async () => {
    const row = await legacyRow();
    const oldHash = row.key_hash;

    expect((await validateApiKey(RAW))?.keyId).toBe(70);

    const rewrite = queries.find(
      (q) =>
        q.sql.trim().startsWith("UPDATE api_keys") &&
        q.sql.includes("key_hash = $1"),
    );
    expect(rewrite?.params).toEqual([storedDigest(RAW), 70, oldHash]);
    expect(row.key_hash).toBe(storedDigest(RAW));

    // The second use finds it by digest, and the path has emptied itself.
    queries.length = 0;
    expect((await validateApiKey(RAW))?.keyId).toBe(70);
    expect(queries.some((q) => q.sql.includes("LIKE '$2%'"))).toBe(false);
  });

  it("does not touch the row when the presented key is wrong", async () => {
    await legacyRow();

    expect(await validateApiKey("vr_live_" + "c".repeat(64))).toBeNull();
    expect(
      queries.some((q) => q.sql.trim().startsWith("UPDATE api_keys")),
    ).toBe(false);
  });

  it("skips the bcrypt scan entirely when no bcrypt row exists", async () => {
    await newKey();

    expect(await validateApiKey("vr_live_" + "c".repeat(64))).toBeNull();
    expect(
      queries.some(
        (q) => q.sql.includes("LIKE '$2%'") && !q.sql.includes("EXISTS"),
      ),
    ).toBe(false);
  });
});
