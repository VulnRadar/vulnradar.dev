import { it, expect, beforeAll, afterAll } from "vitest";
import type { PoolClient } from "pg";
import pool from "@/lib/database/db";
import {
  checkAndRecordRequest,
  incrementDailyCountCapped,
} from "@/lib/rate-limiting/daily-limits";
import { reserveConcurrentScanSlot } from "@/lib/rate-limiting/concurrent-scans";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * The quota gates, run concurrently against a real PostgreSQL.
 *
 * Every one of these paths is a single statement chosen specifically to be
 * atomic: the guarded ON CONFLICT DO UPDATE in the daily counter, the
 * transaction-scoped advisory lock in the slot reservation. A mocked pool
 * cannot evaluate any of that. It returns whatever the test scripted, so a
 * dropped WHERE guard, a lock that no longer serialises, or a CTE that stops
 * returning its RETURNING row all pass with the same green tick. Here, twenty
 * callers really do race for five slots.
 */
describeIntegration(
  "daily quota and concurrency, under real contention",
  () => {
    beforeAll(async () => {
      // The resolvers read system_settings, so the caps below are the ones the
      // real gate enforces, not values injected past it.
      await setSettings({
        BILLING_ENABLED: true,
        BILLING_FREE_LIMIT: 3,
        BILLING_FREE_CONCURRENT_SCANS: 2,
      });
    });

    afterAll(async () => {
      await clearSettings();
    });

    it("never records more than the cap when callers race the daily counter", async () => {
      const user = await createUser();
      const CAP = 5;
      const CALLERS = 20;

      const results = await Promise.all(
        Array.from({ length: CALLERS }, () =>
          incrementDailyCountCapped(user.id, CAP),
        ),
      );

      const recorded = results.filter((r) => r.recorded).length;
      expect(recorded).toBe(CAP);

      // The counter itself, not just the return values: a statement that
      // reported "not recorded" while still bumping the row is exactly the
      // phantom-increment regression the WHERE guard exists to prevent.
      const { rows } = await pool.query<{ count: number }>(
        `SELECT "count" FROM rate_limits
        WHERE key = $1 AND window_start = date_trunc('day', NOW())`,
        [`daily_scan:${user.id}`],
      );
      expect(rows[0]?.count).toBe(CAP);
    });

    it("does not burn a slot for a request it refuses", async () => {
      const user = await createUser();

      const first = await checkAndRecordRequest(user.id);
      const second = await checkAndRecordRequest(user.id);
      const third = await checkAndRecordRequest(user.id);
      expect([first.allowed, second.allowed, third.allowed]).toEqual([
        true,
        true,
        true,
      ]);
      expect(third.used).toBe(3);

      // Two attempts past the cap of 3. Both must be refused AND must leave the
      // counter alone: the pre-guard version reported 4/3 then 5/3, so a user
      // who hit the wall twice could never get back under it for the rest of
      // the day even though neither scan ran.
      const fourth = await checkAndRecordRequest(user.id);
      const fifth = await checkAndRecordRequest(user.id);
      expect(fourth.allowed).toBe(false);
      expect(fifth.allowed).toBe(false);
      expect(fourth.used).toBe(3);
      expect(fifth.used).toBe(3);
      expect(fifth.remaining).toBe(0);

      const { rows } = await pool.query<{ count: number }>(
        `SELECT "count" FROM rate_limits
        WHERE key = $1 AND window_start = date_trunc('day', NOW())`,
        [`daily_scan:${user.id}`],
      );
      expect(rows[0]?.count).toBe(3);
    });

    it("buckets every scan type onto the one day row", async () => {
      // incrementDailyCountCapped (the crawl loop's charge) and
      // checkAndRecordRequest (the single-scan gate) must land on the same key
      // and the same window_start. When they did not, a user could run a full
      // crawl AND a full day of single scans, roughly twice their tier.
      const user = await createUser();
      await checkAndRecordRequest(user.id);
      await incrementDailyCountCapped(user.id, 10);

      const { rows } = await pool.query<{ n: number; count: number }>(
        `SELECT COUNT(*)::int AS n, MAX("count") AS count FROM rate_limits WHERE key = $1`,
        [`daily_scan:${user.id}`],
      );
      expect(rows[0].n).toBe(1);
      expect(Number(rows[0].count)).toBe(2);
    });

    it("admits exactly the plan's concurrent-scan cap when reservations race", async () => {
      const user = await createUser();
      const CAP = 2;
      const CALLERS = 8;

      const insertPendingScan = async (client: PoolClient): Promise<number> => {
        // The same INSERT app/api/v3/scan/route.ts hands the reservation.
        const res = await client.query<{ id: number }>(
          `INSERT INTO scan_history
           (user_id, url, source, notes, status, started_at, categories_total, is_public, team_id)
         VALUES ($1, $2, 'web', 'integration', 'pending', NOW(), $3, false, NULL)
         RETURNING id`,
          [user.id, "https://example.test/", 4],
        );
        return res.rows[0].id;
      };

      const results = await Promise.all(
        Array.from({ length: CALLERS }, () =>
          reserveConcurrentScanSlot(user.id, insertPendingScan),
        ),
      );

      const admitted = results.filter((r) => r.ok).length;
      expect(admitted).toBe(CAP);

      // The rows are the authority. If the advisory lock stopped serialising,
      // several callers would each count 0 or 1 and each insert, so the row
      // count would exceed the cap even while the return values looked right.
      const { rows } = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM scan_history
        WHERE user_id = $1 AND status IN ('pending', 'running')`,
        [user.id],
      );
      expect(rows[0].n).toBe(CAP);
    });

    it("inserts nothing when the reservation is refused", async () => {
      const user = await createUser();
      // Fill the cap of 2 with rows the reservation will count.
      await pool.query(
        `INSERT INTO scan_history (user_id, url, status)
       VALUES ($1, 'https://example.test/a', 'running'),
              ($1, 'https://example.test/b', 'pending')`,
        [user.id],
      );

      let insertCalls = 0;
      const result = await reserveConcurrentScanSlot(
        user.id,
        async (client) => {
          insertCalls += 1;
          const res = await client.query<{ id: number }>(
            `INSERT INTO scan_history (user_id, url, status)
         VALUES ($1, 'https://example.test/c', 'pending') RETURNING id`,
            [user.id],
          );
          return res.rows[0].id;
        },
      );

      expect(result.ok).toBe(false);
      expect(insertCalls).toBe(0);
      const { rows } = await pool.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM scan_history WHERE user_id = $1",
        [user.id],
      );
      expect(rows[0].n).toBe(2);
    });
  },
);
