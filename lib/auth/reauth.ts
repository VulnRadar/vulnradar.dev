import pool from "@/lib/database/db";
import { verifyPassword } from "@/lib/auth/password-hash";

export type ReauthResult =
  { ok: true } | { ok: false; status: 400 | 403; error: string };

/**
 * "Re-enter your current password" for a sensitive account action, with the
 * OAuth-only case handled once instead of five times.
 *
 * An account created through Google/GitHub/Discord has
 * `users.password_hash = NULL` (lib/auth/auth.ts's createOAuthUser), and
 * verifyPassword deliberately returns false for a null hash. Every 2FA
 * enrollment path used to demand a password unconditionally, so those
 * accounts could never enable 2FA, regenerate backup codes, or turn 2FA
 * back off: the UI offered the feature and then dead-ended, and
 * ENFORCE_STAFF_2FA locked any OAuth-created staff account out of every
 * staff route with no way to satisfy the gate. For an account with no
 * password the signed-in session IS the re-auth signal, which is the rule
 * PUT /api/v3/auth/update and DELETE /api/v3/account/delete already follow.
 *
 * Fails closed on a missing users row (a stale session pointing at a
 * deleted account) with the same message a wrong password gets: only a real
 * row whose hash is legitimately null skips the check.
 */
export async function verifyReauthPassword(
  userId: number,
  suppliedPassword: unknown,
  messages: { missing: string; wrong: string },
): Promise<ReauthResult> {
  const row = await pool.query<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId],
  );
  if (row.rows.length === 0) {
    return { ok: false, status: 403, error: messages.wrong };
  }
  const storedHash = row.rows[0].password_hash;
  if (!storedHash) return { ok: true };

  if (typeof suppliedPassword !== "string" || suppliedPassword.length === 0) {
    return { ok: false, status: 400, error: messages.missing };
  }
  if (!(await verifyPassword(suppliedPassword, storedHash))) {
    return { ok: false, status: 403, error: messages.wrong };
  }
  return { ok: true };
}
