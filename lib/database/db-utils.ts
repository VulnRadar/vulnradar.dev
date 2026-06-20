import pool from "./db";

/**
 * Generic CRUD utilities for common database operations
 * Reduces repetitive boilerplate across API endpoints
 */

type DbRow = Record<string, unknown>;

/**
 * R2: Typed shape for the most-used user columns. Callers that need
 * the full row can still fall back to DbRow, but most lookups only
 * touch these fields.
 */
export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  plan: string | null;
  role: string | null;
  disabled_at: string | null;
  email_verified_at: string | null;
  totp_secret: string | null;
  totp_enabled: boolean | null;
  two_factor_method: string | null;
  tos_accepted_at: string | null;
}

// ============================================================================
// User Operations
// ============================================================================

export async function getAdminEmails(): Promise<string[]> {
  try {
    const result = await pool.query(
      "SELECT email FROM users WHERE role = 'admin'",
    );
    return result.rows.map((row: DbRow) => row.email as string);
  } catch (error) {
    console.error("Failed to fetch admin emails:", error);
    return [];
  }
}

/**
 * Get user by ID with optional fields
 */
export async function getUserById(
  userId: number,
  fields = "*",
): Promise<DbRow | null> {
  try {
    const result = await pool.query(
      `SELECT ${fields} FROM users WHERE id = $1`,
      [userId],
    );
    return (result.rows[0] as DbRow) || null;
  } catch (error) {
    console.error("[DB] Failed to get user by ID:", error);
    return null;
  }
}

/**
 * Get user by email. Normalizes input (lowercase + trim) and selects
 * the columns most callers actually need. Login uses password_hash;
 * profile lookups use the rest. This is the canonical helper — callers
 * in lib/auth re-export from here to avoid two divergent copies.
 */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, name, plan, role, disabled_at,
              email_verified_at, totp_secret, totp_enabled,
              two_factor_method, tos_accepted_at
         FROM users WHERE email = $1`,
      [email.toLowerCase().trim()],
    );
    return (result.rows[0] as UserRow) || null;
  } catch (error) {
    console.error("[DB] Failed to get user by email:", error);
    return null;
  }
}

/**
 * Update user fields
 */
export async function updateUser(
  userId: number,
  updates: Record<string, unknown>,
): Promise<DbRow | null> {
  try {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = fields
      .map((field, i) => `${field} = $${i + 1}`)
      .join(", ");

    const result = await pool.query(
      `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`,
      [...values, userId],
    );
    return (result.rows[0] as DbRow) || null;
  } catch (error) {
    console.error("[DB] Failed to update user:", error);
    return null;
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
    const result = await pool.query(
      "DELETE FROM sessions WHERE expires_at < NOW()",
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error("[DB] Failed to delete expired sessions:", error);
    return 0;
  }
}

/**
 * Get active session count for user
 */
export async function getUserSessionCount(userId: number): Promise<number> {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM sessions WHERE user_id = $1 AND expires_at > NOW()",
      [userId],
    );
    return parseInt(((result.rows[0] as DbRow)?.count as string) || "0", 10);
  } catch (error) {
    console.error("[DB] Failed to get session count:", error);
    return 0;
  }
}

// ============================================================================
// Discord Connection Operations
// ============================================================================

/**
 * Get Discord connection for user
 */
export async function getDiscordConnection(
  userId: number,
): Promise<DbRow | null> {
  try {
    const result = await pool.query(
      "SELECT * FROM discord_connections WHERE user_id = $1",
      [userId],
    );
    return (result.rows[0] as DbRow) || null;
  } catch (error) {
    console.error("[DB] Failed to get Discord connection:", error);
    return null;
  }
}

/**
 * Delete Discord connection
 */
export async function deleteDiscordConnection(
  userId: number,
): Promise<boolean> {
  try {
    const result = await pool.query(
      "DELETE FROM discord_connections WHERE user_id = $1",
      [userId],
    );
    return (result.rowCount || 0) > 0;
  } catch (error) {
    console.error("[DB] Failed to delete Discord connection:", error);
    return false;
  }
}

// ============================================================================
// API Key Operations
// ============================================================================

/**
 * Get API key by hash
 */
export async function getApiKeyByHash(hash: string): Promise<DbRow | null> {
  try {
    const result = await pool.query("SELECT * FROM api_keys WHERE hash = $1", [
      hash,
    ]);
    return (result.rows[0] as DbRow) || null;
  } catch (error) {
    console.error("[DB] Failed to get API key:", error);
    return null;
  }
}

/**
 * Get all API keys for user
 */
export async function getUserApiKeys(userId: number): Promise<DbRow[]> {
  try {
    const result = await pool.query(
      "SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return (result.rows as DbRow[]) || [];
  } catch (error) {
    console.error("[DB] Failed to get user API keys:", error);
    return [];
  }
}

/**
 * Revoke API key
 */
export async function revokeApiKey(keyId: number): Promise<boolean> {
  try {
    const result = await pool.query(
      "UPDATE api_keys SET revoked_at = NOW() WHERE id = $1",
      [keyId],
    );
    return (result.rowCount || 0) > 0;
  } catch (error) {
    console.error("[DB] Failed to revoke API key:", error);
    return false;
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
  params: unknown[] = [],
): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM ${table} WHERE ${whereClause}`,
      params,
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error(`[DB] Failed to batch delete from ${table}:`, error);
    return 0;
  }
}

/**
 * Batch update records
 */
export async function batchUpdate(
  table: string,
  updates: Record<string, unknown>,
  whereClause: string,
  params: unknown[] = [],
): Promise<number> {
  try {
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClauses = fields
      .map((field, i) => `${field} = $${i + 1}`)
      .join(", ");

    const result = await pool.query(
      `UPDATE ${table} SET ${setClauses} WHERE ${whereClause}`,
      [...values, ...params],
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error(`[DB] Failed to batch update ${table}:`, error);
    return 0;
  }
}
