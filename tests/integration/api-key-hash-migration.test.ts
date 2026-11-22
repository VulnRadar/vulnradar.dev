import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, createHmac, hash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "@/lib/database/db";
import {
  generateApiKey,
  validateApiKey,
  __resetLegacyKeyRowCache,
} from "@/lib/api/api-keys";
import { hashStoredApiKeys } from "@/lib/auth/security-migration";
import { encryptApiKey } from "@/lib/auth/crypto";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { describeIntegration, createUser } from "./_db";

/**
 * API keys move from ciphertext to a SHA-256 digest, against a real
 * PostgreSQL.
 *
 * 3.9.1 stored each key under AES in api_keys.key_encrypted, a `deprecated_`
 * placeholder in key_hash and an HMAC locator in key_locator. 4.0.0 looks a key
 * up by its digest on the UNIQUE key_hash, and the boot migration
 * (hashStoredApiKeys) rewrites the old rows. What a faked pool cannot speak
 * for is all here: whether the guarded UPDATE matches the row it read, whether
 * the three columns really change together, whether the key then
 * authenticates by the digest alone, and whether the bcrypt predicate
 * (`LIKE '$2%'`) selects what it should.
 *
 * Rows are written the 3.9.1 way with SQL rather than through generateApiKey,
 * which no longer writes ciphertext. The key pair is set by assigning
 * process.env, which the AES layer reads at call time, and restored afterwards
 * so no other suite sees a rotation.
 */
const CURRENT =
  "1111111111111111111111111111111111111111111111111111111111111111";
const OLD = "2222222222222222222222222222222222222222222222222222222222222222";
const STRANGER =
  "3333333333333333333333333333333333333333333333333333333333333333";
const REPLACEMENT =
  "4444444444444444444444444444444444444444444444444444444444444444";

function setKeys(current: string, previous?: string) {
  process.env.API_KEY_ENCRYPTION_KEY = current;
  if (previous === undefined)
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  else process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = previous;
}

/** What key_hash holds from 4.0.0 on (lib/api/api-key-digest.ts). */
function digest(raw: string): string {
  return hash("sha256", "vulnradar-api-key-digest:" + raw, "hex");
}

function newRawKey(): string {
  return `vr_live_${randomBytes(32).toString("hex")}`;
}

interface StoredKey {
  key_hash: string;
  key_locator: string | null;
  key_encrypted: string | null;
}

async function storedKey(id: number): Promise<StoredKey> {
  const { rows } = await pool.query<StoredKey>(
    "SELECT key_hash, key_locator, key_encrypted FROM api_keys WHERE id = $1",
    [id],
  );
  return rows[0];
}

/** A row exactly as 3.9.1's generateApiKey wrote it while `hexKey` was current. */
async function rowWrittenBy391(userId: number, hexKey: string) {
  const raw = newRawKey();
  const saved = process.env.API_KEY_ENCRYPTION_KEY;
  process.env.API_KEY_ENCRYPTION_KEY = hexKey;
  let ciphertext: string;
  try {
    ciphertext = encryptApiKey(raw);
  } finally {
    process.env.API_KEY_ENCRYPTION_KEY = saved;
  }
  const locator = createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(raw)
    .digest("hex")
    .slice(0, 8);
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO api_keys
       (user_id, key_hash, key_locator, key_prefix, name, daily_limit, key_encrypted, scopes)
     VALUES ($1, $2, $3, $4, '3.9.1 key', 100, $5, $6)
     RETURNING id`,
    [
      userId,
      `deprecated_${randomBytes(48).toString("hex")}`,
      locator,
      raw.slice(0, 16),
      ciphertext,
      JSON.stringify([API_KEY_SCOPES.SCAN_READ]),
    ],
  );
  return { id: rows[0].id, raw, ciphertext };
}

const written: number[] = [];

describeIntegration("API keys stored as a digest", () => {
  const original = {
    current: process.env.API_KEY_ENCRYPTION_KEY,
    previous: process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    setKeys(CURRENT);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setKeys(original.current ?? CURRENT, original.previous);
    // A row the migration could not open stays as it is by design, so remove
    // every row this suite wrote rather than leave ciphertext for the next.
    if (written.length > 0) {
      await pool.query("DELETE FROM api_keys WHERE id = ANY($1::int[])", [
        written.splice(0),
      ]);
    }
  });

  it("stores a new key as its digest with no ciphertext or locator", async () => {
    const user = await createUser();
    const created = await generateApiKey(user.id, "new", 100, [
      API_KEY_SCOPES.SCAN_READ,
    ]);
    written.push(created!.id);

    expect(await storedKey(created!.id)).toEqual({
      key_hash: digest(created!.raw_key),
      key_locator: null,
      key_encrypted: null,
    });
    expect((await validateApiKey(created!.raw_key))?.keyId).toBe(created!.id);
  });

  it("converts 3.9.1 rows under the current and the previous key, and they still validate", async () => {
    const user = await createUser();
    const underCurrent = await rowWrittenBy391(user.id, CURRENT);
    const underOld = await rowWrittenBy391(user.id, OLD);
    written.push(underCurrent.id, underOld.id);

    // Before the migration a 4.0.0 server does not open the ciphertext.
    expect(await validateApiKey(underCurrent.raw)).toBeNull();

    setKeys(CURRENT, OLD);
    const stats = await hashStoredApiKeys();
    expect(stats.hashed).toBeGreaterThanOrEqual(2);

    for (const key of [underCurrent, underOld]) {
      expect(await storedKey(key.id)).toEqual({
        key_hash: digest(key.raw),
        key_locator: null,
        key_encrypted: null,
      });
      expect((await validateApiKey(key.raw))?.keyId).toBe(key.id);
    }
  });

  it("changes nothing on a second run", async () => {
    const user = await createUser();
    const key = await rowWrittenBy391(user.id, CURRENT);
    written.push(key.id);
    await hashStoredApiKeys();
    const after = await storedKey(key.id);

    const second = await hashStoredApiKeys();

    expect(second.hashed).toBe(0);
    expect(await storedKey(key.id)).toEqual(after);
  });

  it("keeps validating once API_KEY_ENCRYPTION_KEY is replaced and no previous key is set", async () => {
    const user = await createUser();
    const key = await rowWrittenBy391(user.id, CURRENT);
    written.push(key.id);
    await hashStoredApiKeys();

    setKeys(REPLACEMENT);

    expect((await validateApiKey(key.raw))?.keyId).toBe(key.id);
  });

  it("reports a row neither key opens by count only and leaves it untouched", async () => {
    const user = await createUser();
    const unreadable = await rowWrittenBy391(user.id, STRANGER);
    written.push(unreadable.id);
    const before = await storedKey(unreadable.id);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    setKeys(CURRENT, OLD);
    const stats = await hashStoredApiKeys();

    expect(stats.unreadable).toBeGreaterThanOrEqual(1);
    expect(await storedKey(unreadable.id)).toEqual(before);
    const lines = errorSpy.mock.calls.map((call) => String(call[0]));
    const report = lines.find((line) => line.includes("stored API key"));
    expect(report).toBeDefined();
    expect(report).not.toContain(unreadable.ciphertext);
    expect(report).not.toContain(String(unreadable.id));
    expect(await validateApiKey(unreadable.raw)).toBeNull();
  });

  it("validates a legacy bcrypt row and rewrites it to the digest on first use", async () => {
    const user = await createUser();
    const raw = newRawKey();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, 'bcrypt key') RETURNING id`,
      [user.id, await bcrypt.hash(raw, 4), raw.slice(0, 16)],
    );
    const id = rows[0].id;
    written.push(id);

    // The migration cannot convert it: there is no ciphertext to open.
    await hashStoredApiKeys();
    expect((await storedKey(id)).key_hash.startsWith("$2")).toBe(true);

    // An earlier miss in this process may have cached "no bcrypt rows", which
    // is right in production (nothing writes one after boot) and not here.
    __resetLegacyKeyRowCache();
    expect((await validateApiKey(raw))?.keyId).toBe(id);
    expect(await storedKey(id)).toEqual({
      key_hash: digest(raw),
      key_locator: null,
      key_encrypted: null,
    });
    expect((await validateApiKey(raw))?.keyId).toBe(id);
    expect(await validateApiKey(newRawKey())).toBeNull();
  });

  it("does not bring back a key stored as its bare SHA-256 before 2.2.0", async () => {
    // Those releases wrote sha256(raw) to key_hash. 3.9.1 refuses the row
    // (its bcrypt compare never passes against hex), and so must 4.0.0: a
    // digest lookup that matched it would revive a key dead for months.
    const user = await createUser();
    const raw = newRawKey();
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO api_keys (user_id, key_hash, key_prefix, name)
       VALUES ($1, $2, $3, '2.1 key') RETURNING id`,
      [
        user.id,
        createHash("sha256").update(raw, "utf8").digest("hex"),
        raw.slice(0, 16),
      ],
    );
    written.push(rows[0].id);
    await hashStoredApiKeys();
    __resetLegacyKeyRowCache();

    expect(await validateApiKey(raw)).toBeNull();
  });
});
