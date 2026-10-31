import pool from "./db";

/**
 * Trimmed to the one helper still in use. This file previously held a set of
 * generic CRUD utilities (getUserById, updateUser, getUserApiKeys, revokeApiKey,
 * batchDelete/batchUpdate, etc.); every one of them had zero callers -- the live
 * paths use lib/api/api-keys.ts (ownership-checked) and per-route queries -- so
 * they were removed. The old revokeApiKey in particular deleted by `WHERE id`
 * with no user scope, an IDOR-shaped landmine for anyone who grepped and picked
 * the wrong helper. Only getUserByEmail remains, re-exported from lib/auth/auth.ts.
 */

/**
 * Typed shape for the most-used user columns getUserByEmail returns.
 */
export interface UserRow {
  id: number;
  email: string;
  // Nullable: an account created via OAuth sign-up (see
  // lib/auth/auth.ts's createOAuthUser) may never have a password.
  password_hash: string | null;
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

/**
 * The account with this address, or null when there is none.
 *
 * A database error is NOT "no such account" and is not turned into one: it
 * propagates, so the route's error handler answers 500. This used to catch the
 * error and return null, which made login answer 401 "invalid credentials" to
 * every valid user for as long as Postgres was failing over (after spending a
 * dummy scrypt on each), signup treat every address as new, and the staff
 * invite page tell an existing account holder they had no account.
 */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query(
    `SELECT id, email, password_hash, name, plan, role, disabled_at,
            email_verified_at, totp_secret, totp_enabled,
            two_factor_method, tos_accepted_at
     FROM users WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return (result.rows[0] as UserRow) || null;
}
