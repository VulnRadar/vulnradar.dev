import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { clearUserRateLimitBuckets } from "@/lib/rate-limiting/clear-user-buckets";
import { describeIntegration, createUser } from "./_db";

/**
 * The admin "clear rate limits" pattern, evaluated by Postgres.
 *
 * The unit test for this action mocks the pool, scripts `rowCount: 3`, and
 * asserts the query text contains "DELETE FROM rate_limits". The claim that
 * actually matters -- that clearing user 5 does not also clear user 50 --
 * lives entirely in how Postgres applies `key ~ '(^|:)5($|:)'`, which a faked
 * pool never runs. Weaken the anchors and that test still passes while an
 * admin clearing one account's limits silently hands a free quota reset to
 * every account whose id contains theirs.
 */
async function seedBucket(key: string): Promise<void> {
  await pool.query(
    `INSERT INTO rate_limits (key, "count", window_start)
     VALUES ($1, 1, date_trunc('day', NOW()))
     ON CONFLICT (key, window_start) DO UPDATE SET "count" = 1`,
    [key],
  );
}

async function bucketExists(key: string): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM rate_limits WHERE key = $1`,
    [key],
  );
  return (rows[0]?.n ?? 0) > 0;
}

describeIntegration("clearing one user's rate-limit buckets", () => {
  it("clears every bucket shape for that user and nobody else's", async () => {
    // Real ids, so the neighbour cases are the ones the anchoring exists for:
    // an id that contains the target's digits as a prefix and as a suffix.
    const user = await createUser();
    const id = user.id;
    const neighbours = [`${id}0`, `9${id}`];

    const mine = [
      `daily_scan:${id}`,
      `login:${id}`,
      `password_reset:${id}:203.0.113.7`,
    ];
    const theirs = [
      ...neighbours.map((n) => `daily_scan:${n}`),
      // An IP-keyed bucket that merely ends in the same digits: the segment
      // is "203.0.113.<id>", not "<id>", so it must survive.
      `login_ip:203.0.113.${id}`,
    ];

    for (const key of [...mine, ...theirs]) await seedBucket(key);

    const cleared = await clearUserRateLimitBuckets(id);
    expect(cleared).toBe(mine.length);

    for (const key of mine) {
      expect(await bucketExists(key), `${key} should be cleared`).toBe(false);
    }
    for (const key of theirs) {
      expect(await bucketExists(key), `${key} should survive`).toBe(true);
    }

    // Leave the shared table as it was found: other suites count rows in it.
    await pool.query("DELETE FROM rate_limits WHERE key = ANY($1::text[])", [
      theirs,
    ]);
  });

  it("reports zero for a user with nothing to clear", async () => {
    const user = await createUser();
    expect(await clearUserRateLimitBuckets(user.id)).toBe(0);
  });
});
