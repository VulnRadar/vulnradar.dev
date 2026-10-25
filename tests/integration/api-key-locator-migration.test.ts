import { it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import pool from "@/lib/database/db";
import { generateApiKey, validateApiKey } from "@/lib/api/api-keys";
import { decryptApiKey } from "@/lib/auth/crypto";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { describeIntegration, createUser } from "./_db";

/**
 * API keys across a rotation of API_KEY_ENCRYPTION_KEY, against a real
 * PostgreSQL.
 *
 * validateApiKey finds a key by an 8-character HMAC locator stored in
 * api_keys.key_locator. The HMAC is keyed with API_KEY_ENCRYPTION_KEY, so a
 * rotation leaves every stored locator computed under the old key. The fix
 * looks a missed key up again under PREVIOUS_API_KEY_ENCRYPTION_KEY and, on a
 * match, REWRITES THE ROW. That rewrite is the part a faked pool cannot
 * speak for: whether the UPDATE's WHERE matches the row it just read, whether
 * both columns really change, and whether the key still authenticates after
 * the old key is gone are all properties of the stored row, so they are
 * asserted on the stored row.
 *
 * The key pair is set by assigning process.env, which both the locator HMAC
 * and the AES layer read at call time, and restored afterwards so no other
 * suite sees a rotation.
 */
const CURRENT =
  "1111111111111111111111111111111111111111111111111111111111111111";
const OLD = "2222222222222222222222222222222222222222222222222222222222222222";

function locatorUnder(hexKey: string, rawKey: string): string {
  return createHmac("sha256", Buffer.from(hexKey, "hex"))
    .update(rawKey)
    .digest("hex")
    .slice(0, 8);
}

function setKeys(current: string, previous?: string) {
  process.env.API_KEY_ENCRYPTION_KEY = current;
  if (previous === undefined)
    delete process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY;
  else process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY = previous;
}

interface StoredKey {
  key_locator: string;
  key_encrypted: string;
}

async function storedKey(id: number): Promise<StoredKey> {
  const { rows } = await pool.query<StoredKey>(
    "SELECT key_locator, key_encrypted FROM api_keys WHERE id = $1",
    [id],
  );
  return rows[0];
}

/** Mint a key while `OLD` is the deployment's key, then perform the rotation. */
async function keyIssuedBeforeRotation(userId: number) {
  setKeys(OLD);
  const created = await generateApiKey(userId, "pre-rotation", 100, [
    API_KEY_SCOPES.SCAN_READ,
  ]);
  expect(created).not.toBeNull();
  return { id: created!.id as number, raw: created!.raw_key as string };
}

describeIntegration("API key locator migration across a key rotation", () => {
  const original = {
    current: process.env.API_KEY_ENCRYPTION_KEY,
    previous: process.env.PREVIOUS_API_KEY_ENCRYPTION_KEY,
  };

  beforeEach(() => {
    setKeys(CURRENT);
  });

  afterEach(() => {
    setKeys(original.current ?? CURRENT, original.previous);
  });

  it("stores the locator under the key that was current when the key was issued", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);

    expect((await storedKey(id)).key_locator).toBe(locatorUnder(OLD, raw));
    expect(locatorUnder(OLD, raw)).not.toBe(locatorUnder(CURRENT, raw));
  });

  it("cannot find the key after the rotation unless the old key is kept as the previous one", async () => {
    const user = await createUser();
    const { raw } = await keyIssuedBeforeRotation(user.id);

    setKeys(CURRENT);

    // The failure this fix exists for, as it happened to operators.
    expect(await validateApiKey(raw)).toBeNull();
  });

  it("finds the key through the previous locator and authenticates it", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);

    setKeys(CURRENT, OLD);
    const result = await validateApiKey(raw);

    expect(result?.keyId).toBe(id);
    expect(result?.userId).toBe(user.id);
  });

  it("rewrites the stored locator and ciphertext under the current key", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);
    const before = await storedKey(id);

    setKeys(CURRENT, OLD);
    await validateApiKey(raw);

    const after = await storedKey(id);
    expect(after.key_locator).toBe(locatorUnder(CURRENT, raw));
    expect(after.key_encrypted).not.toBe(before.key_encrypted);

    // The ciphertext opens with the current key alone...
    setKeys(CURRENT);
    expect(decryptApiKey(after.key_encrypted)).toBe(raw);
    // ...and no longer opens with the old key alone, so the row really moved.
    setKeys(OLD);
    expect(() => decryptApiKey(after.key_encrypted)).toThrow();
  });

  it("keeps authenticating once the previous key has been removed", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);

    setKeys(CURRENT, OLD);
    await validateApiKey(raw);
    setKeys(CURRENT);

    expect((await validateApiKey(raw))?.keyId).toBe(id);
  });

  it("migrates only the key that was presented, leaving the account's others for their own first use", async () => {
    const user = await createUser();
    const first = await keyIssuedBeforeRotation(user.id);
    const second = await generateApiKey(user.id, "second", 100, [
      API_KEY_SCOPES.SCAN_READ,
    ]);
    const secondBefore = await storedKey(second!.id);

    setKeys(CURRENT, OLD);
    await validateApiKey(first.raw);

    expect(await storedKey(second!.id)).toEqual(secondBefore);
  });

  it("copes with the same key arriving twice at once", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);

    setKeys(CURRENT, OLD);
    const results = await Promise.all([
      validateApiKey(raw),
      validateApiKey(raw),
      validateApiKey(raw),
    ]);

    // Every caller authenticates, one of them wins the UPDATE, and the row
    // ends up in the single consistent state.
    expect(results.map((r) => r?.keyId)).toEqual([id, id, id]);
    const after = await storedKey(id);
    expect(after.key_locator).toBe(locatorUnder(CURRENT, raw));
    setKeys(CURRENT);
    expect(decryptApiKey(after.key_encrypted)).toBe(raw);
  });

  it("leaves a revoked key revoked, and still moves its row", async () => {
    const user = await createUser();
    const { id, raw } = await keyIssuedBeforeRotation(user.id);
    await pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE id = $1", [
      id,
    ]);

    setKeys(CURRENT, OLD);

    expect(await validateApiKey(raw)).toBeNull();
    expect((await storedKey(id)).key_locator).toBe(locatorUnder(CURRENT, raw));
  });

  it("rejects an unknown key without writing anything", async () => {
    const user = await createUser();
    const { id } = await keyIssuedBeforeRotation(user.id);
    const before = await storedKey(id);

    setKeys(CURRENT, OLD);

    expect(await validateApiKey("vr_live_not_a_key_anyone_issued")).toBeNull();
    expect(await storedKey(id)).toEqual(before);
  });
});
