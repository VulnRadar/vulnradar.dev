import { it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { FIRST_ACCOUNT_LOCK } from "@/lib/auth/auth";
import { describeIntegration } from "./_db";

/**
 * The property lib/auth/auth.ts's insertUserRow relies on, against a real
 * PostgreSQL: under READ COMMITTED, a transaction that waits on the advisory
 * lock and only then runs its INSERT evaluates the
 * `CASE WHEN NOT EXISTS (...)` subquery against a snapshot taken after the
 * first transaction committed, so it sees the first row and does not also
 * promote itself. A faked pool answers the same SQL either way.
 *
 * The real users table is never empty in this shared database, so the same
 * statement shape runs against a throwaway table of its own.
 */
describeIntegration("first account role, under real contention", () => {
  const table = `first_account_probe_${randomBytes(4).toString("hex")}`;
  const insertSql = `INSERT INTO ${table} (role)
     VALUES (CASE WHEN NOT EXISTS (SELECT 1 FROM ${table}) THEN 'super_admin' ELSE 'user' END)
     RETURNING role`;

  beforeAll(async () => {
    await pool.query(
      `CREATE TABLE ${table} (id SERIAL PRIMARY KEY, role TEXT)`,
    );
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
  });

  it("gives the second of two simultaneous first signups the 'user' role", async () => {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query("BEGIN");
      await first.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        FIRST_ACCOUNT_LOCK,
      ]);
      const firstRole = (await first.query<{ role: string }>(insertSql)).rows[0]
        .role;

      // Starts while the first insert is still uncommitted, and has to wait
      // for the lock.
      const secondRole = (async () => {
        await second.query("BEGIN");
        await second.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          FIRST_ACCOUNT_LOCK,
        ]);
        const { rows } = await second.query<{ role: string }>(insertSql);
        await second.query("COMMIT");
        return rows[0].role;
      })();

      // Give the second transaction time to reach the lock and block on it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      await first.query("COMMIT");

      expect(firstRole).toBe("super_admin");
      expect(await secondRole).toBe("user");
      const { rows } = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE role = 'super_admin'`,
      );
      expect(rows[0].count).toBe(1);
    } finally {
      await first.query("ROLLBACK").catch(() => {});
      await second.query("ROLLBACK").catch(() => {});
      first.release();
      second.release();
    }
  });
});
