import { randomBytes } from "node:crypto"
import bcrypt from "bcryptjs"
import pool from "@/lib/database/db"
import { API_KEY_PREFIX, DEFAULT_API_KEY_DAILY_LIMIT, TERMS_UPDATED_AT } from "@/lib/config/constants"
import { encryptApiKey, decryptApiKey, isEncryptionConfigured } from "@/lib/auth/crypto"

// Helper function to generate a random deprecated placeholder string
function generateDeprecatedPlaceholder(): string {
    // Generate 64 random bytes as hex (fully random, no predictable pattern)
    return `deprecated_${randomBytes(48).toString("hex")}`
}

// Generate a new API key - returns the raw key (only shown once) and metadata
// dailyLimit defaults to DEFAULT_API_KEY_DAILY_LIMIT if not specified
export async function generateApiKey(userId: number, name: string = "Default", dailyLimit?: number) {
    const limit = dailyLimit ?? DEFAULT_API_KEY_DAILY_LIMIT
    
    // Generate a random key: vr_live_<64 hex chars>
    const raw = `${API_KEY_PREFIX}${randomBytes(32).toString("hex")}`
    const prefix = raw.slice(0, API_KEY_PREFIX.length + 8) // show prefix + some chars

    let keyHash: string
    let keyEncrypted: string | null = null

    if (isEncryptionConfigured()) {
        // If encryption key is available, store encrypted key + deprecated placeholder
        keyEncrypted = encryptApiKey(raw)
        keyHash = generateDeprecatedPlaceholder()
    } else {
        // If no encryption key, use bcrypt-based hashing for lookup
        keyHash = await hashKey(raw)
    }

    const result = await pool.query(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, daily_limit, key_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, key_prefix, name, daily_limit, created_at`,
        [userId, keyHash, prefix, name, limit, keyEncrypted],
    )

    return {
        ...result.rows[0],
        raw_key: raw, // Only returned on creation, never stored in plaintext
    }
}

// Hash the API key with bcrypt for secure storage
async function hashKey(key: string): Promise<string> {
    const saltRounds = 12
    return await bcrypt.hash(key, saltRounds)
}

// Compare API key with its hash
async function verifyKey(key: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(key, hash)
}

// Fallback date for terms updated at (in case config loading fails)
const TERMS_UPDATED_AT_FALLBACK = "2025-03-16"

// Check if user has accepted the latest terms
function hasAcceptedLatestTerms(termsAcceptedAt: string | null): boolean {
    if (!termsAcceptedAt) return false
    try {
        const acceptedDate = new Date(termsAcceptedAt)
        const termsDate = TERMS_UPDATED_AT || TERMS_UPDATED_AT_FALLBACK
        const termsUpdatedDate = new Date(termsDate)
        // Validate dates are valid
        if (isNaN(acceptedDate.getTime()) || isNaN(termsUpdatedDate.getTime())) {
            // If dates are invalid, assume terms are accepted to avoid blocking
            return true
        }
        return acceptedDate >= termsUpdatedDate
    } catch {
        // On any error, don't block the user
        return true
    }
}

// Validate an API key and return the user/key info, or null
// Returns { needsTermsAcceptance: true } if user hasn't accepted latest terms
export async function validateApiKey(key: string): Promise<{
    keyId: number
    userId: number
    email: string
    userName: string
    keyName: string
    dailyLimit: number
    needsTermsAcceptance?: boolean
} | null> {
    if (isEncryptionConfigured()) {
        // If encryption is configured, fetch all encrypted keys and decrypt to compare
        const result = await pool.query(
            `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit, ak.revoked_at, ak.key_encrypted,
                    u.email, u.name as user_name, u.tos_accepted_at
             FROM api_keys ak
                      JOIN users u ON ak.user_id = u.id
             WHERE ak.key_encrypted IS NOT NULL`,
        )

        // Try to find a matching key by decryption
        for (const row of result.rows) {
            try {
                const decryptedKey = decryptApiKey(row.key_encrypted)
                if (decryptedKey === key) {
                    if (row.revoked_at) return null

                    return {
                        keyId: row.key_id,
                        userId: row.user_id,
                        email: row.email,
                        userName: row.user_name,
                        keyName: row.name,
                        dailyLimit: row.daily_limit,
                        needsTermsAcceptance: !hasAcceptedLatestTerms(row.tos_accepted_at),
                    }
                }
            } catch (error) {
                // Decryption failed for this key, try next one
                continue
            }
        }

        // Fallback: try hash-based lookup (for old keys without encryption)
        const hashResult = await pool.query(
            `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit, ak.revoked_at, ak.key_hash,
                    u.email, u.name as user_name, u.tos_accepted_at
             FROM api_keys ak
                      JOIN users u ON ak.user_id = u.id
             WHERE ak.key_hash IS NOT NULL AND ak.key_encrypted IS NULL`,
        )

        // Try to find a matching key by bcrypt comparison
        for (const row of hashResult.rows) {
            try {
                if (await verifyKey(key, row.key_hash)) {
                    if (row.revoked_at) return null

                    return {
                        keyId: row.key_id,
                        userId: row.user_id,
                        email: row.email,
                        userName: row.user_name,
                        keyName: row.name,
                        dailyLimit: row.daily_limit,
                        needsTermsAcceptance: !hasAcceptedLatestTerms(row.tos_accepted_at),
                    }
                }
            } catch (error) {
                // Comparison failed for this key, try next one
                continue
            }
        }
    } else {
        // Fallback: hash-based lookup if encryption is not configured
        const result = await pool.query(
            `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit, ak.revoked_at, ak.key_hash,
                    u.email, u.name as user_name, u.tos_accepted_at
             FROM api_keys ak
                      JOIN users u ON ak.user_id = u.id
             WHERE ak.key_hash IS NOT NULL`,
        )

        // Try to find a matching key by bcrypt comparison
        for (const row of result.rows) {
            try {
                if (await verifyKey(key, row.key_hash)) {
                    if (row.revoked_at) return null

                    return {
                        keyId: row.key_id,
                        userId: row.user_id,
                        email: row.email,
                        userName: row.user_name,
                        keyName: row.name,
                        dailyLimit: row.daily_limit,
                        needsTermsAcceptance: !hasAcceptedLatestTerms(row.tos_accepted_at),
                    }
                }
            } catch (error) {
                // Comparison failed for this key, try next one
                continue
            }
        }

        return null
    }
}

// Check rate limit - returns { allowed, remaining, limit, resetsAt }
export async function checkRateLimit(keyId: number, dailyLimit: number) {
    // Count usage in the last 24 hours
    const result = await pool.query(
        `SELECT COUNT(*)::int as count FROM api_usage
         WHERE api_key_id = $1 AND used_at > NOW() - INTERVAL '24 hours'`,
        [keyId],
    )

    const used = result.rows[0].count
    const remaining = Math.max(0, dailyLimit - used)
    const allowed = remaining > 0

    // Get the oldest usage in the window to calculate reset time
    const oldestResult = await pool.query(
        `SELECT used_at FROM api_usage
         WHERE api_key_id = $1 AND used_at > NOW() - INTERVAL '24 hours'
         ORDER BY used_at ASC LIMIT 1`,
        [keyId],
    )

    let resetsAt: string
    if (oldestResult.rows.length > 0) {
        const oldest = new Date(oldestResult.rows[0].used_at)
        resetsAt = new Date(oldest.getTime() + 24 * 60 * 60 * 1000).toISOString()
    } else {
        resetsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }

    return { allowed, remaining, limit: dailyLimit, used, resetsAt }
}

// Record a usage event
export async function recordUsage(keyId: number) {
    await pool.query("INSERT INTO api_usage (api_key_id) VALUES ($1)", [keyId])
    // Update last_used_at on the key
    await pool.query(
        "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
        [keyId],
    )
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
    )

    return result.rows
}

// Revoke an API key
export async function revokeApiKey(keyId: number, userId: number) {
    const result = await pool.query(
        "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id",
        [keyId, userId],
    )
    return result.rows.length > 0
}

// Rotate an API key - deletes old key and creates new one with same name
// Returns the new key details including raw_key (only shown once)
export async function rotateApiKey(keyId: number, userId: number, dailyLimit?: number) {
    // Get the old key's name first
    const oldKeyResult = await pool.query(
        "SELECT name, daily_limit FROM api_keys WHERE id = $1 AND user_id = $2",
        [keyId, userId],
    )
    
    if (oldKeyResult.rows.length === 0) {
        return null
    }
    
    const { name, daily_limit: oldLimit } = oldKeyResult.rows[0]
    
    // Hard delete the old key - no trace
    await pool.query(
        "DELETE FROM api_keys WHERE id = $1",
        [keyId],
    )
    
    // Generate a new key with the same name and the provided limit (or old limit)
    const newKey = await generateApiKey(userId, name, dailyLimit ?? oldLimit)
    
    return newKey
}
