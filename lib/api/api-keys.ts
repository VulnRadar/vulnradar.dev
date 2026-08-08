import { randomBytes, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "@/lib/database/db";
import {
  API_KEY_PREFIX,
  DEFAULT_API_KEY_DAILY_LIMIT,
} from "@/lib/config/constants";
import {
  encryptApiKey,
  decryptApiKey,
  isEncryptionConfigured,
} from "@/lib/auth/crypto";
import { getClientIp, ipsInSameSubnet } from "@/lib/api/request-utils";
import { getSettings } from "@/lib/config/runtime-config";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { newLoginEmail } from "@/lib/email/email";

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
  // This is NOT a password. It is a keyed HMAC over a CSPRNG-generated
  // 256-bit API key used as a deterministic column index for O(1) lookup.
  // The 256-bit key entropy makes brute-force irrelevant; bcrypt would be
  // wrong here because we need a deterministic, fast, keyed hash.
  const hmac = createHmac("sha256", getLocatorSecret());
  // codeql[js/insufficient-password-hash]
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
  // bcrypt silently truncates input at 72 bytes. Assert here so a future
  // prefix change doesn't silently reduce key entropy.
  if (Buffer.byteLength(key, "utf8") > 72) {
    throw new Error(
      `[api-keys] Key length ${Buffer.byteLength(key, "utf8")} bytes exceeds bcrypt's 72-byte limit; extend the fallback path to pre-hash with SHA-256`,
    );
  }
  const saltRounds = 12;
  return await bcrypt.hash(key, saltRounds);
}

// Compare API key with its hash
async function verifyKey(key: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(key, hash);
}

// Check if user has accepted the latest terms. termsUpdatedAt is resolved by
// the caller through the runtime config (database, then env, then the
// shipped CONFIG_TERMS_UPDATED_AT default) so an admin's edit to the terms
// date takes effect on the next request, no rebuild required.
function hasAcceptedLatestTerms(
  termsAcceptedAt: string | null,
  termsUpdatedAt: string,
): boolean {
  if (!termsAcceptedAt) return false;
  try {
    const acceptedDate = new Date(termsAcceptedAt);
    const termsUpdatedDate = new Date(termsUpdatedAt);
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

function rowToResult(
  row: {
    key_id: number;
    user_id: number;
    name: string;
    daily_limit: number;
    email: string;
    user_name: string;
    tos_accepted_at: string | null;
  },
  termsUpdatedAt: string,
): KeyValidationResult {
  return {
    keyId: row.key_id,
    userId: row.user_id,
    email: row.email,
    userName: row.user_name,
    keyName: row.name,
    dailyLimit: row.daily_limit,
    needsTermsAcceptance: !hasAcceptedLatestTerms(
      row.tos_accepted_at,
      termsUpdatedAt,
    ),
  };
}

/**
 * ip-binding: optional, off-by-default defense against a leaked API key
 * being used from somewhere other than where it's meant to run (see
 * lib/config/config-values.ts for the tradeoff — API keys get a
 * stricter default subnet than sessions, but the feature itself
 * defaults to off because a key used from CI does not necessarily have
 * a stable IP: GitHub Actions and similar shared-runner providers hand
 * out a different address on every job).
 *
 * The first successful use of a key after binding is enabled adopts
 * that request's subnet as the key's home network (there is nothing yet
 * to compare against). Every later mismatch declines just that one
 * request — the key itself is never revoked, and a legitimate owner
 * recovers by rotating the key (which starts a fresh, unbound row) or by
 * simply retrying from the expected network. Returns true (no-op) when
 * the feature is disabled or when the current IP can't be determined.
 */
export async function passesApiKeyIpBinding(row: {
  key_id: number;
  bound_ip?: string | null;
  user_id: number;
  email: string;
  name: string;
}): Promise<boolean> {
  const settings = await getSettings([
    "API_KEY_IP_BINDING_ENABLED",
    "API_KEY_IP_BINDING_IPV4_PREFIX",
    "API_KEY_IP_BINDING_IPV6_PREFIX",
  ] as const);
  if (!settings.API_KEY_IP_BINDING_ENABLED) return true;

  const currentIp = await getClientIp();
  if (!currentIp || currentIp === "unknown") return true;

  const boundIp = row.bound_ip;
  if (!boundIp || boundIp === "unknown") {
    await pool
      .query(
        "UPDATE api_keys SET bound_ip = $1 WHERE id = $2 AND bound_ip IS NULL",
        [currentIp, row.key_id],
      )
      .catch((err) =>
        console.error("[api-keys] Failed to record bound_ip:", err),
      );
    return true;
  }

  if (
    ipsInSameSubnet(
      currentIp,
      boundIp,
      Number(settings.API_KEY_IP_BINDING_IPV4_PREFIX),
      Number(settings.API_KEY_IP_BINDING_IPV6_PREFIX),
    )
  ) {
    return true;
  }

  await notifyApiKeyIpMismatch({
    userId: row.user_id,
    userEmail: row.email,
    keyName: row.name,
    previousIp: boundIp,
    currentIp,
  });

  return false;
}

/**
 * ip-binding: best-effort notification for an API key IP mismatch — a
 * security_alerts row for the admin-facing alert surface, plus the same
 * "new login" email sent for a session mismatch (see
 * notifySessionIpMismatch in lib/auth/auth.ts), reused here rather than
 * adding a new email template for what is, from the account owner's
 * point of view, the same event. Awaited by the caller (the mismatch
 * path already declines the request, so the extra latency is an
 * acceptable trade for not having a dangling background promise) but
 * never throws itself, so a notification failure cannot turn into an
 * unhandled rejection or change whether the request is treated as
 * authenticated.
 */
async function notifyApiKeyIpMismatch(params: {
  userId: number;
  userEmail: string;
  keyName: string;
  previousIp: string;
  currentIp: string;
}): Promise<void> {
  const { userId, userEmail, keyName, previousIp, currentIp } = params;

  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details, ip_address)
       VALUES ($1, 'api_key_ip_mismatch', 'medium', $2, $3, $4)`,
      [
        userId,
        `API key "${keyName}" was used from a network it is not bound to. The request was declined; the key itself was not revoked.`,
        JSON.stringify({ keyName, previousIp, currentIp }),
        currentIp,
      ],
    )
    .catch((err) =>
      console.error(
        "[api-keys] Failed to record api_key_ip_mismatch alert:",
        err,
      ),
    );

  try {
    const emailContent = newLoginEmail(
      `An unrecognized network (API key "${keyName}")`,
      currentIp,
      { ipAddress: currentIp, userAgent: "API request (no browser)" },
    );
    await sendNotificationEmail({
      userId,
      userEmail,
      type: "api_keys",
      emailContent,
    });
  } catch (err) {
    console.error("[api-keys] Failed to send api_key_ip_mismatch email:", err);
  }
}

// Validate an API key and return the user/key info, or null.
// Uses an indexed key_locator for O(1) lookup instead of a full-table scan.
// Returns { needsTermsAcceptance: true } if user hasn't accepted latest terms.
export async function validateApiKey(
  key: string,
): Promise<KeyValidationResult | null> {
  const locator = computeKeyLocator(key);
  const { TERMS_UPDATED_AT: termsUpdatedAt } = await getSettings([
    "TERMS_UPDATED_AT",
  ] as const);

  if (isEncryptionConfigured()) {
    // Primary path: O(1) indexed lookup by HMAC locator.
    const locatorResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_encrypted, ak.bound_ip,
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
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
        }
      } catch {
        continue;
      }
    }

    // Backfill: key matched a row that has no locator yet (legacy row).
    // Compute locator from decrypted key and persist it for future lookups.
    const legacyResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_encrypted, ak.key_locator, ak.bound_ip,
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
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
        }
      } catch {
        continue;
      }
    }

    // Fallback: hash-based bcrypt lookup (old keys without encryption).
    const hashResult = await pool.query(
      `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
              ak.revoked_at, ak.key_hash, ak.bound_ip,
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
          if (!(await passesApiKeyIpBinding(row))) return null;
          return rowToResult(row, termsUpdatedAt);
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
            ak.revoked_at, ak.key_hash, ak.bound_ip,
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
        if (!(await passesApiKeyIpBinding(row))) return null;
        return rowToResult(row, termsUpdatedAt);
      }
    } catch {
      continue;
    }
  }

  // Legacy bcrypt keys without locator: full scan (backfill on match).
  const legacyHashResult = await pool.query(
    `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit,
            ak.revoked_at, ak.key_hash, ak.bound_ip,
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
        if (!(await passesApiKeyIpBinding(row))) return null;
        return rowToResult(row, termsUpdatedAt);
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

  // Hard delete the old key - no trace. Re-check ownership in the WHERE
  // clause itself (not just the SELECT above) so a future refactor can't
  // turn this into a delete-any-key-by-id primitive.
  await pool.query("DELETE FROM api_keys WHERE id = $1 AND user_id = $2", [
    keyId,
    userId,
  ]);

  // Generate a new key with the same name and the provided limit (or old limit)
  const newKey = await generateApiKey(userId, name, dailyLimit ?? oldLimit);

  return newKey;
}
