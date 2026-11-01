import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { getSetting } from "@/lib/config/runtime-config";
import { hashAuthToken } from "@/lib/auth/token-hash";

/**
 * Mint a password reset token for an account, replacing any it already has,
 * and return the raw token for the emailed link. Only its keyed digest is
 * stored (lib/auth/token-hash.ts).
 *
 * forgot-password and the admin "send reset link" action both used to run
 * DELETE then INSERT as two autocommit statements, so two requests for one
 * account could each delete before either inserted and leave two live
 * links. A transaction alone does not stop that under READ COMMITTED: when
 * the account has no row yet, neither DELETE has anything to lock, so
 * neither waits. The transaction-scoped advisory lock serialises replacements
 * per account, and the second one's DELETE then sees the first one's row.
 *
 * An advisory lock rather than SELECT ... FOR UPDATE on the user row: the
 * reset route locks the token row and then the user row, so taking the user
 * row first here would be the opposite order and the two could deadlock.
 * The advisory lock is not a row lock, so it cannot form that cycle.
 */
export async function issuePasswordResetToken(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashAuthToken(token);
  const passwordResetHours = await getSetting("PASSWORD_RESET_HOURS");
  const expiresAt = new Date(Date.now() + passwordResetHours * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `password-reset-token:${userId}`,
    ]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
      userId,
    ]);
    await client.query(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [userId, tokenHash, expiresAt],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return token;
}
