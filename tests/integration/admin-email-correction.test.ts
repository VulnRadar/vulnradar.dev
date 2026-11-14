import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { replaceAccountEmail } from "@/lib/admin/account-email";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * An admin's email correction against a self-service change in flight.
 *
 * The correction used to be one statement with its token DELETE in a
 * data-modifying CTE. Postgres runs an unreferenced CTE after the main
 * statement, so the correction locked the user row before the token rows,
 * while app/api/v3/auth/update locks the token rows and then the user row.
 * The two racing each other deadlocked (40P01) and the admin got a 500.
 * Which locks a statement takes, and in what order, is Postgres's answer
 * alone: a faked pool runs both orders the same way.
 */

const seededUsers: number[] = [];

describeIntegration("an admin's email correction", () => {
  afterAll(async () => {
    if (seededUsers.length === 0) return;
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [
      seededUsers,
    ]);
  });

  it("waits for a self-service change in flight instead of deadlocking with it", async () => {
    const user = await createUser();
    seededUsers.push(user.id);
    const corrected = `${unique("corrected")}@example.test`;
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, email)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour', $3)`,
      [user.id, unique("evt"), `${unique("waiting")}@example.test`],
    );

    // The self-service change, in auth/update's order: the token rows, then
    // the user row, in one transaction.
    const selfService = await pool.connect();
    let correction: Promise<void> | null = null;
    try {
      await selfService.query("BEGIN");
      await selfService.query(
        "DELETE FROM email_verification_tokens WHERE user_id = $1",
        [user.id],
      );

      // The correction starts while those token rows are held. Whatever it
      // locks first, it has a moment to take it before the change goes on.
      correction = replaceAccountEmail(user.id, corrected);
      await new Promise((resolve) => setTimeout(resolve, 300));

      await selfService.query(
        "UPDATE users SET pending_email = $1, updated_at = NOW() WHERE id = $2",
        [`${unique("next")}@example.test`, user.id],
      );
      await selfService.query("COMMIT");
    } catch (err) {
      await selfService.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      selfService.release();
    }

    // Neither side was chosen as a deadlock victim, and the correction, which
    // waited, is what the account ends up with.
    await expect(correction).resolves.toBeUndefined();
    const { rows } = await pool.query<{
      email: string;
      pending_email: string | null;
      email_verified_at: Date | null;
    }>(
      "SELECT email, pending_email, email_verified_at FROM users WHERE id = $1",
      [user.id],
    );
    expect(rows[0]).toEqual({
      email: corrected,
      pending_email: null,
      email_verified_at: null,
    });
    const { rows: links } = await pool.query(
      "SELECT 1 FROM email_verification_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(links).toHaveLength(0);
  });

  it("cancels the waiting change and every link mailed for it", async () => {
    const user = await createUser();
    seededUsers.push(user.id);
    const corrected = `${unique("corrected")}@example.test`;
    await pool.query("UPDATE users SET pending_email = $1 WHERE id = $2", [
      `${unique("waiting")}@example.test`,
      user.id,
    ]);
    await pool.query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, email)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour', $3),
              ($1, $4, NOW() + INTERVAL '1 hour', $5)`,
      [user.id, unique("evt"), user.email, unique("evt"), corrected],
    );

    await replaceAccountEmail(user.id, corrected);

    const { rows } = await pool.query<{ pending_email: string | null }>(
      "SELECT pending_email FROM users WHERE id = $1",
      [user.id],
    );
    expect(rows[0].pending_email).toBeNull();
    const { rows: links } = await pool.query(
      "SELECT 1 FROM email_verification_tokens WHERE user_id = $1",
      [user.id],
    );
    expect(links).toHaveLength(0);
  });
});
