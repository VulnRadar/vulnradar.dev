import { it, expect, beforeAll, afterAll } from "vitest";
import pool from "@/lib/database/db";
import {
  performDatabaseCleanup,
  SCAN_RETENTION_BATCH_SIZE,
} from "@/lib/database/cleanup";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * Plan-scoped scan retention across more than one batch.
 *
 * The prune deletes SCAN_RETENTION_BATCH_SIZE rows per statement and keeps
 * going until a batch comes back short. The mocked unit tier proves the loop
 * asks again; this proves the SQL it asks with: that a batch selects by id,
 * that the subquery's LIMIT really bounds each statement, that the next
 * statement finds what the last one left, and that the plan scoping holds
 * across every batch rather than only the first. A backlog one batch and a
 * bit deep is the smallest that exercises all of it.
 */
const FREE_BACKLOG = SCAN_RETENTION_BATCH_SIZE * 2 + 350;
const CORE_OLD = 10;

describeIntegration("scan retention in batches", () => {
  let freeUserId: number;
  let coreUserId: number;

  async function seedScans(userId: number, count: number, daysOld: number) {
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status, scanned_at)
       SELECT $1::int, 'https://batch-' || g || '.example.test/', 'completed',
              NOW() - ($3::int * INTERVAL '1 day')
         FROM generate_series(1, $2::int) AS g`,
      [userId, count, daysOld],
    );
  }

  async function countFor(userId: number, olderThanDays?: number) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM scan_history
        WHERE user_id = $1
          AND ($2::int IS NULL OR scanned_at < NOW() - ($2::int * INTERVAL '1 day'))`,
      [userId, olderThanDays ?? null],
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    // Free is on a 30 day window. Core is left at its shipped -1 (keep
    // forever), so its old scans must survive every batch the free plan runs.
    await setSettings({ BILLING_FREE_RETENTION: 30 });
    freeUserId = (await createUser({ plan: "free" })).id;
    coreUserId = (await createUser({ plan: "core_supporter" })).id;
    await seedScans(freeUserId, FREE_BACKLOG, 90);
    await seedScans(freeUserId, 3, 1);
    await seedScans(coreUserId, CORE_OLD, 90);
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM scan_history WHERE user_id = ANY($1::int[])",
      [[freeUserId, coreUserId]],
    );
    await clearSettings();
  });

  it("drains a backlog deeper than one batch and leaves what is inside the window", async () => {
    expect(await countFor(freeUserId, 30)).toBe(FREE_BACKLOG);

    const stats = await performDatabaseCleanup();

    expect(await countFor(freeUserId, 30)).toBe(0);
    // The fresh scans are the only ones left.
    expect(await countFor(freeUserId)).toBe(3);
    expect(stats.oldScans).toBeGreaterThanOrEqual(FREE_BACKLOG);
  });

  it("never touches a plan whose retention is unlimited, in any batch", async () => {
    expect(await countFor(coreUserId, 30)).toBe(CORE_OLD);
  });
});
