import { afterEach, expect, it } from "vitest";

import pool from "@/lib/database/db";
import { countRecentInFlightScans } from "@/lib/database/boot/graceful-shutdown";
import { createUser, describeIntegration } from "./_db";

/**
 * The drain waits on this count, so a query that matched too little would cut
 * live scans on every deploy, and one that matched too much would cost every
 * deploy the whole 30 seconds. A faked pool cannot tell those apart.
 */

const GRACE_SECONDS = 600;

async function insertScan(
  userId: number,
  status: string,
  startedSecondsAgo: number | null,
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at)
     VALUES ($1, 'https://example.test/drain', $2,
             CASE WHEN $3::int IS NULL THEN NULL
                  ELSE NOW() - ($3::int || ' seconds')::interval END,
             NOW() - ($3::int || ' seconds')::interval)
     RETURNING id`,
    [userId, status, startedSecondsAgo],
  );
  return rows[0].id;
}

describeIntegration("countRecentInFlightScans", () => {
  const created: number[] = [];

  afterEach(async () => {
    await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
      created.splice(0),
    ]);
  });

  async function baseline(): Promise<number> {
    return countRecentInFlightScans(pool, GRACE_SECONDS);
  }

  it("counts pending and running rows inside the grace window", async () => {
    const before = await baseline();
    const user = await createUser();
    created.push(
      await insertScan(user.id, "pending", 5),
      await insertScan(user.id, "running", 30),
    );
    await expect(baseline()).resolves.toBe(before + 2);
  });

  it("leaves out finished rows and orphans older than the window", async () => {
    const before = await baseline();
    const user = await createUser();
    created.push(
      await insertScan(user.id, "completed", 5),
      await insertScan(user.id, "failed", 5),
      await insertScan(user.id, "running", GRACE_SECONDS * 2),
    );
    await expect(baseline()).resolves.toBe(before);
  });
});
