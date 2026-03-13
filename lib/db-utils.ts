import pool from "./db"

/**
 * Generic CRUD utilities for common database operations
 * Reduces repetitive boilerplate across API endpoints
 */

// ============================================================================
// User Operations
// ============================================================================

export async function getAdminEmails(): Promise<string[]> {
  try {
    const result = await pool.query("SELECT email FROM users WHERE role = 'admin'")
    return result.rows.map((row: any) => row.email)
  } catch (error) {
    console.error("Failed to fetch admin emails:", error)
    return []
  }
}

/**
 * Get user by ID with optional fields
 */
export async function getUserById(userId: number, fields = "*"): Promise<any | null> {
  try {
    const result = await pool.query(`SELECT ${fields} FROM users WHERE id = $1`, [userId])
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to get user by ID:", error)
    return null
  }
}

/**
 * Get user by email
 */
export async function getUserByEmail(email: string): Promise<any | null> {
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email])
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to get user by email:", error)
    return null
  }
}

/**
 * Update user fields
 */
export async function updateUser(userId: number, updates: Record<string, any>): Promise<any | null> {
  try {
    const fields = Object.keys(updates)
    const values = Object.values(updates)
    const setClauses = fields.map((field, i) => `${field} = $${i + 1}`).join(", ")

    const result = await pool.query(
      `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, userId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to update user:", error)
    return null
  }
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Delete expired sessions
 */
export async function deleteExpiredSessions(): Promise<number> {
  try {
    const result = await pool.query("DELETE FROM sessions WHERE expires_at < NOW()")
    return result.rowCount || 0
  } catch (error) {
    console.error("[DB] Failed to delete expired sessions:", error)
    return 0
  }
}

/**
 * Get active session count for user
 */
export async function getUserSessionCount(userId: number): Promise<number> {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM sessions WHERE user_id = $1 AND expires_at > NOW()",
      [userId]
    )
    return parseInt(result.rows[0]?.count || 0, 10)
  } catch (error) {
    console.error("[DB] Failed to get session count:", error)
    return 0
  }
}

// ============================================================================
// Discord Connection Operations
// ============================================================================

/**
 * Get Discord connection for user
 */
export async function getDiscordConnection(userId: number): Promise<any | null> {
  try {
    const result = await pool.query(
      "SELECT * FROM discord_connections WHERE user_id = $1",
      [userId]
    )
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to get Discord connection:", error)
    return null
  }
}

/**
 * Delete Discord connection
 */
export async function deleteDiscordConnection(userId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      "DELETE FROM discord_connections WHERE user_id = $1",
      [userId]
    )
    return (result.rowCount || 0) > 0
  } catch (error) {
    console.error("[DB] Failed to delete Discord connection:", error)
    return false
  }
}

// ============================================================================
// API Key Operations
// ============================================================================

/**
 * Get API key by hash
 */
export async function getApiKeyByHash(hash: string): Promise<any | null> {
  try {
    const result = await pool.query("SELECT * FROM api_keys WHERE hash = $1", [hash])
    return result.rows[0] || null
  } catch (error) {
    console.error("[DB] Failed to get API key:", error)
    return null
  }
}

/**
 * Get all API keys for user
 */
export async function getUserApiKeys(userId: number): Promise<any[]> {
  try {
    const result = await pool.query(
      "SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    )
    return result.rows || []
  } catch (error) {
    console.error("[DB] Failed to get user API keys:", error)
    return []
  }
}

/**
 * Revoke API key
 */
export async function revokeApiKey(keyId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1",
      [keyId]
    )
    return (result.rowCount || 0) > 0
  } catch (error) {
    console.error("[DB] Failed to revoke API key:", error)
    return false
  }
}

// ============================================================================
// Batch Operations
// ============================================================================

/**
 * Batch delete records
 */
export async function batchDelete(
  table: string,
  whereClause: string,
  params: any[] = []
): Promise<number> {
  try {
    const result = await pool.query(`DELETE FROM ${table} WHERE ${whereClause}`, params)
    return result.rowCount || 0
  } catch (error) {
    console.error(`[DB] Failed to batch delete from ${table}:`, error)
    return 0
  }
}

/**
 * Batch update records
 */
export async function batchUpdate(
  table: string,
  updates: Record<string, any>,
  whereClause: string,
  params: any[] = []
): Promise<number> {
  try {
    const fields = Object.keys(updates)
    const values = Object.values(updates)
    const setClauses = fields.map((field, i) => `${field} = $${i + 1}`).join(", ")

    const result = await pool.query(
      `UPDATE ${table} SET ${setClauses} WHERE ${whereClause}`,
      [...values, ...params]
    )
    return result.rowCount || 0
  } catch (error) {
    console.error(`[DB] Failed to batch update ${table}:`, error)
    return 0
  }
}

