import pool from "@/lib/database/db";

/**
 * An admin's correction of an account's email address.
 *
 * The admin's address replaces any change the account had waiting:
 * pending_email is cleared and every outstanding verification link is deleted
 * in the same transaction. A link mailed before the correction could otherwise
 * still be opened afterwards and swap its own address back in over the
 * admin's.
 *
 * Two statements, the token rows first and the user row second, which is the
 * order a self-service change (app/api/v3/auth/update) writes them and a link
 * click (app/api/v3/auth/verify-email) locks them in, so a correction racing
 * either one waits for it. This was one statement with the DELETE in a
 * data-modifying CTE, which Postgres runs after the main UPDATE when nothing
 * reads it: the user row was locked first, and a correction racing a change
 * in flight could deadlock and answer 500.
 */
export async function replaceAccountEmail(
  userId: number,
  newEmail: string,
): Promise<void> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [
      userId,
    ]);
    await tx.query(
      `UPDATE users
          SET email = $1, email_verified_at = NULL, pending_email = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [newEmail, userId],
    );
    await tx.query("COMMIT");
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
}
