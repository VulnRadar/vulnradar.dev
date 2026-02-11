import { randomBytes, createHash } from "node:crypto"
import pool from "./db"

const DAILY_LIMIT = 50

// Generate a new API key - returns the raw key (only shown once) and metadata
export async function generateApiKey(userId: number, name: string = "Default") {
    // Generate a random key: vr_live_<32 hex chars>
    const raw = `vr_live_${randomBytes(24).toString("hex")}`
    const prefix = raw.slice(0, 12) // "vr_live_xxxx" for display
    const keyHash = hashKey(raw)

    const result = await pool.query(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, daily_limit)
         VALUES ($1, $2, $3, $4, $5)
             RETURNING id, key_prefix, name, daily_limit, created_at`,
        [userId, keyHash, prefix, name, DAILY_LIMIT],
    )

    return {
        ...result.rows[0],
        raw_key: raw, // Only returned on creation, never stored
    }
}

// Hash the API key for storage
function hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex")
}

// Validate an API key and return the user/key info, or null
export async function validateApiKey(key: string) {
    const keyHash = hashKey(key)

    const result = await pool.query(
        `SELECT ak.id as key_id, ak.user_id, ak.name, ak.daily_limit, ak.revoked_at,
                u.email, u.name as user_name
         FROM api_keys ak
                  JOIN users u ON ak.user_id = u.id
         WHERE ak.key_hash = $1`,
        [keyHash],
    )

    if (result.rows.length === 0) return null

    const row = result.rows[0]

    // Check if revoked
    if (row.revoked_at) return null

    return {
        keyId: row.key_id,
        userId: row.user_id,
        email: row.email,
        userName: row.user_name,
        keyName: row.name,
        dailyLimit: row.daily_limit,
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