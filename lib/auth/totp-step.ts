import pool from "@/lib/database/db";

/**
 * Spend one TOTP time step for this account: true when `counter` is past the
 * last one used, which is then recorded; false for a replay. Locked, so two
 * requests with the same code cannot both pass.
 *
 * The one copy of the rule. POST /auth/2fa/verify at sign-in and the staff
 * second factor in front of updates and impersonation both call it, on the
 * same users.totp_last_counter column, so a code spent in one place cannot be
 * used again in the other. `counter` is the step the code actually matched,
 * not the wall-clock step: a code is valid for a few steps either side, and
 * keying on the clock would let one code be replayed once per step.
 */
export async function consumeTotpStep(
  userId: number,
  counter: number,
): Promise<boolean> {
  const step = BigInt(counter);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query(
      "SELECT totp_last_counter FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const last = res.rows[0]?.totp_last_counter;
    if (last !== null && last !== undefined && BigInt(last) >= step) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      "UPDATE users SET totp_last_counter = $1 WHERE id = $2",
      [String(step), userId],
    );
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
