import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Hashed in front of the key, so the stored digest is never the key's bare
 * SHA-256.
 *
 * Releases before 2.2.0 stored exactly that, sha256(raw), in this same
 * key_hash column: every key made before 1.9.2, and after it any key made
 * without API_KEY_ENCRYPTION_KEY. Those keys have answered 401 since bcrypt
 * replaced the bare hash, and 3.9.1 still refuses them (its bcrypt compare
 * never passes against a hex string), but nothing revoked the rows. A bare
 * digest here would quietly turn every one of them back on, with the full
 * scope set a key from before scopes is grandfathered into.
 *
 * Changing this string invalidates every stored key.
 */
const DIGEST_DOMAIN = "vulnradar-api-key-digest:";

/**
 * The stored form of an API key: the SHA-256 digest of DIGEST_DOMAIN and the
 * raw key, as 64 lowercase hex characters, in api_keys.key_hash.
 *
 * Not a password hash, and deliberately not a slow one. The key is 256 bits
 * from a CSPRNG (generateApiKey), so there is nothing to guess and no
 * dictionary to slow down; what a slow hash would buy against a human-chosen
 * password, the key's entropy already buys here. It is also unkeyed, so the
 * stored value does not depend on API_KEY_ENCRYPTION_KEY and survives any
 * rotation of it.
 *
 * Kept in its own module so the boot migration (lib/auth/security-migration.ts)
 * computes exactly what validation looks up without importing the whole key
 * module.
 */
export function hashApiKey(rawKey: string): string {
  const input = DIGEST_DOMAIN + rawKey;
  // A 256-bit random API key, not a password (see above).
  // codeql[js/insufficient-password-hash]
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two digests. The lookup by key_hash has already
 * matched, so this is a second check rather than the only one, but it costs
 * nothing and keeps every secret compare in the codebase on timingSafeEqual.
 * The length is checked first because timingSafeEqual throws on a mismatch;
 * a digest's length is not a secret.
 */
export function apiKeyDigestsMatch(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
