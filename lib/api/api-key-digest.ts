import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The stored form of an API key: the SHA-256 digest of the raw key, as 64
 * lowercase hex characters, in api_keys.key_hash.
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
  // A 256-bit random API key, not a password (see above).
  // codeql[js/insufficient-password-hash]
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
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
