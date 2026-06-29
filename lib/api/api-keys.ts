import { randomBytes, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "@/lib/database/db";
import {
  API_KEY_PREFIX,
  DEFAULT_API_KEY_DAILY_LIMIT,
  TERMS_UPDATED_AT,
} from "@/lib/config/constants";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";

// Helper function to generate a random deprecated placeholder string
function generateDeprecatedPlaceholder(): string {
  // Generate 64 random bytes as hex (fully random, no predictable pattern)
  return `deprecated_${randomBytes(48).toString("hex")}`;
}

// Derive a server-side secret for key locator HMAC.
// removed the hardcoded `"vulnradar-key-locator-v1"`
// fallback. A global default in the source would let anyone who read the
// source compute the locator for any stolen key. Require the real secret.
function getLocatorSecret(): Buffer {
  const enc = process.env.API_KEY_ENCRYPTION_KEY;
  if (enc && enc.length === 64) {
    return Buffer.from(enc, "hex");
  }
  throw new Error(
    "[api-keys] API_KEY_ENCRYPTION_KEY must be set to a 64-character hex " +
      "string (32 bytes) to compute API key locators. " +
      "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}
// Compute a deterministic 8-hex-char locator for indexed O(1) lookup.
// HMAC-SHA256(rawKey, secret)  first 4 bytes  hex.
function computeKeyLocator(rawKey: string): string {
  // codeql[js/insufficient-password-hash]
  // linter suppress: CodeQL flags this as "password hashed with
  // insufficient computational effort" because the value being
  // hashed is a random 256-bit API key. This is NOT a user-chosen
  // password - it is a CSPRNG-generated secret with 256 bits of
  // entropy. HMAC-SHA256 is a keyed hash (not bcrypt) because the
  // use case is a deterministic content-derived column index for
  // fast O(1) lookup, not password storage. The output is 32 bits
  // of HMAC, used only as a uniqueness key, not as a credential
  // verifier. See lib/api/api-keys.test.ts for the threat model.
  const hmac = createHmac("sha256", getLocatorSecret());
  hmac.update(rawKey);
  return hmac.digest("hex").slice(0, 8);
}

// Generate a new API key - returns the raw key (only shown once) and metadata
// dailyLimit defaults to DEFAULT_API_KEY_DAILY_LIMIT if not specified
export async function generateApiKey(
  userId: number,
  name: string = "Default",
  dailyLimit?: number,
) {
  const limit = dailyLimit ?? DEFAULT_API_KEY_DAILY_LIMIT;

  // Generate a random key: vr_live_<64 hex chars>
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, API_KEY_PREFIX.length + 8); // show prefix + some chars
  const locator = computeKeyLocator(raw);

  let keyHash: string;
  let keyEncrypted: string | null = null;

  if (isEncryptionConfigured()) {
    // If encryption key is available, store encrypted key + deprecated placeholder
    keyEncrypted = encryptApiKey(raw);
    keyHash = generateDeprecatedPlaceholder();
  } else {
    // If no encryption key, use bcrypt-based hashing for lookup
    keyHash = await hashKey(raw);
  }

  const result = await pool.query(
    `INSERT INTO api_keys (user_id, key_hash, key_locator, key_prefix, name, daily_limit, key_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, key_prefix, name, daily_limit, created_at`,
    [userId, keyHash, locator, prefix, name, limit, keyEncrypted],
  );

  return {
    ...result.rows[0],
    raw_key: raw, // Only returned on creation, never stored in plaintext
  };
}

// Hash the API key with bcrypt for secure storage
async function hashKey(key: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(key, saltRounds);
}

// Compare API key with its hash
async function verifyKey(key: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(key, hash);
}

// Fallback date for terms updated at (in case config loading fails)
const TERMS_UPDATED_AT_FALLBACK = "2025-03-16";

// Check if user has accepted the latest terms
function hasAcceptedLatestTerms(termsAcceptedAt: string | null): boolean {
  if (!termsAcceptedAt) return false;
  try {
    const acceptedDate = new Date(termsAcceptedAt);
    const termsDate = TERMS_UPDATED_AT || TERMS_UPDATED_AT_FALLBACK;
    const termsUpdatedDate = new Date(termsDate);
    // Validate dates are valid
    if (isNaN(acceptedDate.getTime()) || isNaN(termsUpdatedDate.getTime())) {
      // If dates are invalid, assume terms are accepted to avoid blocking
      return true;
    }
    return acceptedDate >= termsUpdatedDate;
  } catch {
    // On any error, don't block the user
    return true;
  }
}

interface KeyValidationResult {
  keyId: number;
  userId: number;
  email: string;
  userName: string;
  keyName: string;
  dailyLimit: number;
  needsTermsAcceptance?: boolean;
}

function rowToResult(row: {
  key_id: number;
  user_id: number;
  name: string;
  daily_limit: number;
  email: string;
  user_name: string;
  tos_accepted_at: string | null;
}): KeyValidationResult {
  return {
    keyId: row.key_id,
    userId: row.user_id,
    email: row.email,
    userName: row.user_name,
    keyName: row.name,
    dailyLimit: row.daily_limit,
    needsTermsAcceptance: !hasAcceptedLatestTerms(row.tos_accepted_at),
  };
}

// Validate an API key and return the user/key info, or null.
// Uses an indexed key_locator for O(1) lookup instead of a full-table scan.
// Returns { needsTermsAcceptance: true } if user hasn't accepted latest terms.
export async function validateApiKey(
  key: string,
): Promise<KeyValidationResult | null> {
  const locator = computeKeyLocator(key);

  if (isEncryptionConfigured()) {
    // Primary path: O(1) indexed lookup by HMAC locator.
    const locatorResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_encrypted,
              u.email, u.name as user_name, u.tos_accepted_at
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
        WHERE ak.key_locator = $1
          AND ak.key_encrypted IS NOT NULL`,
      [locator],
    );

    for (const row of locatorResult.rows) {
      try {
        const decrypted = decryptApiKey(row.key_encrypted);
        if (decrypted === key) {
          if (row.revoked_at) return null;
          return rowToResult(row);
        }
      } catch {
        continue;
      }
    }

    // Backfill: key matched a row that has no locator yet (legacy row).
    // Compute locator from decrypted key and persist it for future lookups.
    const legacyResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_encrypted, ak.key_locator,
              u.email, u.name as user_name, u.tos_accepted_at
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
        WHERE ak.key_locator IS NULL
          AND ak.key_encrypted IS NOT NULL`,
    );
    for (const row of legacyResult.rows) {
      try {
        const decrypted = decryptApiKey(row.key_encrypted);
        if (decrypted === key) {
          // Persist locator so subsequent lookups are O(1).
          await pool
            .query(
              "UPDATE api_keys SET key_locator = $1 WHERE id = $2 AND key_locator IS NULL",
              [computeKeyLocator(decrypted), row.key_id],
            )
            .catch(() => undefined);
          if (row.revoked_at) return null;
          return rowToResult(row);
        }
      } catch {
        continue;
      }
    }

    // Fallback: hash-based bcrypt lookup (old keys without encryption).
    const hashResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_hash,
              u.email, u.name as user_name, u.tos_accepted_at
         FROM api_keys ak
              JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash IS NOT NULL
          AND ak.key_locator IS NULL
          AND ak.key_encrypted IS NULL`,
    );
    for (const row of hashResult.rows) {
      try {
        if (await verifyKey(key, row.key_hash)) {
          if (row.revoked_at) return null;
          return rowToResult(row);
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  // No encryption configured: O(1) locator lookup for bcrypt-hashed keys.
  const locatorResult = await pool.query(
    `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
            ak.revoked_at, ak.key_hash,
            u.email, u.name as user_name, u.tos_accepted_at
       FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
      WHERE ak.key_locator = $1
        AND ak.key_hash IS NOT NULL`,
    [locator],
  );
  for (const row of locatorResult.rows) {
    try {
      if (await verifyKey(key, row.key_hash)) {
        if (row.revoked_at) return null;
        return rowToResult(row);
      }
    } catch {
      continue;
    }
  }

  // Legacy bcrypt keys without locator: full scan (backfill on match).
  const legacyHashResult = await pool.query(
    `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
            ak.revoked_at, ak.key_hash,
            u.email, u.name as user_name, u.tos_accepted_at
       FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
      WHERE ak.key_hash IS NOT NULL
        AND ak.key_locator IS NULL`,
  );
  for (const row of legacyHashResult.rows) {
    try {
      if (await verifyKey(key, row.key_hash)) {
        await pool
          .query(
            "UPDATE api_keys SET key_locator = $1 WHERE id = $2 AND key_locator IS NULL",
            [locator, row.key_id],
          )
          .catch(() => undefined);
        if (row.revoked_at) return null;
        return rowToResult(row);
      }
    } catch {
      continue;
    }
  }

  return null;
}

// rate-limit: atomic check-and-increment under a row lock.
// Concurrent requests observing `used = limit - 1` would otherwise
// both pass and both insert — a real billing-cap bypass for paid
// API customers. The lock on api_keys.id serializes the count +
// insert, so the second request sees the first's incremented
// counter and is rejected.
export async function checkRateLimit(keyId: number, dailyLimit: number) {
  // Use a dedicated client so the BEGIN / COMMIT is scoped to this
  // call and we can issue SELECT ... FOR UPDATE + INSERT + count on
  // the same connection.
  const client = await pool.connect();
  let inserted = false;
  try {
    await client.query("BEGIN");
    // Acquire a row lock on the api_keys row. SELECT ... FOR UPDATE
    // blocks any other transaction trying to lock the same row until
    // we COMMIT.
    const lockResult = await client.query<{ id: number }>(
      "SELECT id FROM api_keys WHERE id = $1 FOR UPDATE",
      [keyId],
    );
    if (lockResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        allowed: false,
        remaining: 0,
        limit: dailyLimit,
        used: 0,
        resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    // Count current usage in the 24h window (now that we hold the lock).
    const countResult = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM api_usage
         WHERE api_key_id = $1
           AND used_at > NOW() - INTERVAL '24 hours'`,
      [keyId],
    );
    const used = countResult.rows[0]?.count ?? 0;
    const allowed = used < dailyLimit;

    if (allowed) {
      await client.query("INSERT INTO api_usage (api_key_id) VALUES ($1)", [
        keyId,
      ]);
      inserted = true;
    }

    await client.query("COMMIT");

    const usedAfter = allowed ? used + 1 : used;
    const remaining = Math.max(0, dailyLimit - usedAfter);

    // Update last_used_at on the key (best-effort, fire-and-forget on
    // a separate connection so it doesn't extend our transaction).
    pool
      .query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [keyId])
      .catch((err) =>
        console.error("[api-keys] last_used_at update failed:", err),
      );

    // Calculate reset time (oldest usage in the window + 24h).
    let resetsAt: string;
    if (inserted && used > 0) {
      // The oldest usage before this request stays the same; just add 24h.
      resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    } else {
      resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }
    // Best-effort: fetch oldest usage for a precise reset time. Done
    // outside the lock to keep the lock window short.
    const oldestResult = await pool.query<{ used_at: Date }>(
      `SELECT used_at FROM api_usage
         WHERE api_key_id = $1 AND used_at > NOW() - INTERVAL '24 hours'
         ORDER BY used_at ASC LIMIT 1`,
      [keyId],
    );
    if (oldestResult.rows.length > 0) {
      const oldest = new Date(oldestResult.rows[0].used_at);
      resetsAt = new Date(oldest.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    return { allowed, remaining, limit: dailyLimit, used: usedAfter, resetsAt };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// rate-limit: no-op stub. The atomic checkRateLimit above both
// counts AND inserts under a row lock — the old read-then-write
// race is gone. Kept only so existing call sites don't crash; new
// code must not call this.
export async function recordUsage(_keyId: number) {
  /* no-op: see checkRateLimit above for the atomic implementation */
  return;
}

// Get all API keys for a user (without the actual key, just metadata)
export async function getUserApiKeys(userId: number) {
  const result = await pool.query(
    `SELECT ak.id, ak.key_prefix, ak.name, ak.daily_limit, ak.created_at, ak.last_used_at, ak.revoked_at,
                (SELECT COUNT(*)::int FROM api_usage au WHERE au.api_key_id = ak.id AND au.used_at > NOW() - INTERVAL '24 hours') as usage_today
         FROM api_keys ak
         WHERE ak.user_id = $1
         ORDER BY ak.created_at DESC`,
    [userId],
  );

  return result.rows;
}

// Revoke an API key
export async function revokeApiKey(keyId: number, userId: number) {
  const result = await pool.query(
    "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id",
    [keyId, userId],
  );
  return result.rows.length > 0;
}

// Rotate an API key - deletes old key and creates new one with same name
// Returns the new key details including raw_key (only shown once)
export async function rotateApiKey(
  keyId: number,
  userId: number,
  dailyLimit?: number,
) {
  // Get the old key's name first
  const oldKeyResult = await pool.query(
    "SELECT name, daily_limit FROM api_keys WHERE id = $1 AND user_id = $2",
    [keyId, userId],
  );

  if (oldKeyResult.rows.length === 0) {
    return null;
  }

  const { name, daily_limit: oldLimit } = oldKeyResult.rows[0];

  // Hard delete the old key - no trace
  await pool.query("DELETE FROM api_keys WHERE id = $1", [keyId]);

  // Generate a new key with the same name and the provided limit (or old limit)
  const newKey = await generateApiKey(userId, name, dailyLimit ?? oldLimit);

  return newKey;
}
