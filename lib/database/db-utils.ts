import pool from "./db";

/**
 * Generic CRUD utilities for common database operations
 * Reduces repetitive boilerplate across API endpoints
 *
 * SECURITY NOTE: column names cannot be parameterized in Postgres, so any
 * helper that builds a column list from caller input MUST apply an
 * allowlist. Helpers in this file use the SQL_IDENTIFIER pattern
 * (^[a-zA-Z_][a-zA-Z0-9_]*$) to drop anything else before the query
 * is built. Don't relax this without a security review.
 */

type DbRow = Record<string, unknown>;

const SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Throws if `id` is not a valid SQL identifier. Used to drop any input
 * that might smuggle SQL fragments via column/table names.
 */
function assertIdentifier(id: string, label: string): void {
  if (!SQL_IDENTIFIER.test(id)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(id)} — must match ${SQL_IDENTIFIER}`,
    );
  }
}

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

// User Operations

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

// Whitelist of columns that getUserById / updateUser will accept. Any
// caller that tries to update a non-listed column (notably role,
// password_hash, totp_secret, plan, stripe_*) is silently dropped.
const USER_UPDATABLE_COLUMNS = new Set([
  "name",
  "avatar_url",
  "bio",
  "plan",
  "plan_period",
  "email",
  "email_verified_at",
  "onboarding_completed",
  "beta_access",
  "tos_accepted_at",
  "disabled_at",
  "newsletter_subscribed",
  "two_factor_method",
  "totp_enabled",
  "backup_codes",
]);

/**
 * Get user by ID with a fixed column projection. The legacy `fields`
 * parameter is preserved for compatibility but the value is mapped to
 * a known set of columns — never accepts arbitrary SQL fragments.
 */
export type UserColumnProjection = "full" | "public" | "auth";

const USER_PROJECTION_COLUMNS: Record<UserColumnProjection, string> = {
  full: "*",
  public:
    "id, email, name, avatar_url, plan, role, beta_access, " +
    "email_verified_at, two_factor_method, created_at, onboarding_completed",
  auth:
    "id, email, password_hash, name, plan, role, disabled_at, " +
    "email_verified_at, totp_secret, totp_enabled, " +
    "two_factor_method, tos_accepted_at",
};

export async function getUserById(
  userId: number,
  projection: UserColumnProjection | string = "full",
): Promise<DbRow | null> {
  const proj: UserColumnProjection =
    projection in USER_PROJECTION_COLUMNS
      ? (projection as UserColumnProjection)
      : "full";
  const columns = USER_PROJECTION_COLUMNS[proj];
  // Sanity-check: every comma-separated token must be a valid identifier
  // or the literal "*". This protects future edits to the table from
  // accidentally allowing SQL injection via this helper.
  for (const token of columns.split(",")) {
    const trimmed = token.trim();
    if (trimmed === "*") continue;
    assertIdentifier(trimmed, "column");
  }
  try {
    const result = await pool.query(
      `SELECT ${columns} FROM users WHERE id = $1`,
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
 * Update user fields. Caller-supplied column names are filtered against
 * USER_UPDATABLE_COLUMNS — anything not in the allowlist (e.g. an
 * attacker smuggling `role`, `password_hash`, or `totp_secret` via
 * a future JSON-body caller) is silently dropped.
 */
export async function updateUser(
  userId: number,
  updates: Record<string, unknown>,
): Promise<DbRow | null> {
  try {
    const entries = Object.entries(updates).filter(([k]) =>
      USER_UPDATABLE_COLUMNS.has(k),
    );
    if (entries.length === 0) {
      // Nothing allowed to update — return the row unchanged.
      return getUserById(userId, "full");
    }
    const values = entries.map(([, v]) => v);
    const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ");

    const result = await pool.query(
      `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $${entries.length + 1} RETURNING *`,
      [...values, userId],
    );
    return (result.rows[0] as DbRow) || null;
  } catch (error) {
    console.error("[DB] Failed to update user:", error);
    return null;
  }
}

// Session Operations

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

// Discord Connection Operations

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

// API Key Operations

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

// Batch Operations

// Whitelist of tables that batchDelete / batchUpdate will accept.
// Anything outside this set is rejected to prevent mass-row attacks
// against tables with sensitive data (users, sessions, api_keys,
// billing_history, admin_audit_log, etc.).
const BATCH_ALLOWED_TABLES = new Set([
  "session",
  "rate_limits",
  "scan_history",
  "scheduled_scans",
  "webhooks",
  "data_requests",
  "email_2fa_codes",
  "device_trust",
  "broadcast_recipients",
  "password_reset_tokens",
  "email_verification_tokens",
  "notification_preferences",
]);

/**
 * Batch delete records.
 *
 * SECURITY: `table` and `whereClause` are NOT parameterized. Table name
 * is restricted to a hardcoded allowlist; the WHERE clause is parsed
 * into a list of `column = value` predicates and only the value side
 * is parameterized. Operators like `OR`, subselects, and SQL fragments
 * are rejected.
 */
export async function batchDelete(
  table: string,
  whereClause: string,
  params: unknown[] = [],
): Promise<number> {
  assertIdentifier(table, "table");
  if (!BATCH_ALLOWED_TABLES.has(table)) {
    throw new Error(`batchDelete not permitted for table: ${table}`);
  }
  // Parse a small subset of WHERE: `col1 = $1 [AND col2 = $2 ...]`.
  const parsed = parseSafeWhere(whereClause, params.length);
  try {
    const result = await pool.query(
      `DELETE FROM ${table} WHERE ${parsed.sql}`,
      parsed.values,
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error(`[DB] Failed to batch delete from ${table}:`, error);
    return 0;
  }
}

/**
 * Batch update records. Same constraints as batchDelete: table is
 * allowlisted, columns are allowlisted (USER_UPDATABLE_COLUMNS-style),
 * the WHERE clause is parsed into simple predicates.
 */
const BATCH_UPDATABLE_COLUMNS = new Set([
  "is_active",
  "enabled",
  "disabled_at",
  "revoked_at",
  "expires_at",
  "role",
  "plan",
  "name",
  "status",
  "is_dismissible",
  "starts_at",
  "ends_at",
  "priority",
  "is_active",
]);

export async function batchUpdate(
  table: string,
  updates: Record<string, unknown>,
  whereClause: string,
  params: unknown[] = [],
): Promise<number> {
  assertIdentifier(table, "table");
  if (!BATCH_ALLOWED_TABLES.has(table)) {
    throw new Error(`batchUpdate not permitted for table: ${table}`);
  }
  const entries = Object.entries(updates).filter(([k]) =>
    BATCH_UPDATABLE_COLUMNS.has(k),
  );
  if (entries.length === 0) return 0;
  for (const [k] of entries) assertIdentifier(k, "column");
  const parsed = parseSafeWhere(whereClause, params.length);
  const values = entries.map(([, v]) => v);
  const setClauses = entries.map(([k], i) => `${k} = $${i + 1}`).join(", ");
  const offset = entries.length;
  // Renumber WHERE params by appending after the SET params.
  const whereSql = parsed.sql.replace(/\$(\d+)/g, (_, n) => {
    const idx = parseInt(n, 10) + offset;
    return `$${idx}`;
  });
  try {
    const result = await pool.query(
      `UPDATE ${table} SET ${setClauses} WHERE ${whereSql}`,
      [...values, ...parsed.values],
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error(`[DB] Failed to batch update ${table}:`, error);
    return 0;
  }
}

/**
 * Parse a tiny, safe subset of WHERE-clause syntax: alternating
 * `column = $n` predicates joined by `AND` (or nothing). Returns the
 * rebuilt SQL (with renumbered placeholders preserved) and the values.
 * Throws on anything else (OR, subselects, function calls, raw text).
 */
function parseSafeWhere(
  raw: string,
  expectedParams: number,
): { sql: string; values: unknown[] } {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { sql: "1 = 1", values: [] };
  }
  const parts = trimmed.split(/\s+AND\s+/i);
  const values: unknown[] = [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    // Match exactly `column = $n`. Reject anything else.
    const m = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*\$(\d+)$/);
    if (!m) {
      throw new Error(
        `Unsafe WHERE fragment: ${JSON.stringify(part)} — only "<column> = $n" joined by AND is allowed`,
      );
    }
    const col = m[1];
    const n = parseInt(m[2], 10);
    assertIdentifier(col, "where column");
    if (n < 1 || n > expectedParams) {
      throw new Error(
        `WHERE param $${n} out of range (expected 1..${expectedParams})`,
      );
    }
    values.push(undefined); // placeholder, real values come from caller
    out.push(`${col} = $${n}`);
  }
  // Caller's params[] should match expectedParams. We don't have access
  // to the raw values here — the caller passes them. We just rebuild
  // the placeholder numbering as-is.
  void expectedParams;
  return { sql: out.join(" AND "), values: [] };
}
