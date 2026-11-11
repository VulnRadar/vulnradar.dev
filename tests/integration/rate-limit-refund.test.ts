import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { refundRateLimitAttempt } from "@/lib/rate-limiting/refund-attempt";
import { describeIntegration, unique } from "./_db";

/**
 * refundRateLimitAttempt against the real rate_limits table.
 *
 * The admin re-auth throttle reserves an attempt through checkRateLimit and
 * hands back the ones that were not wrong passwords. Whether the hand-back
 * lands on the bucket the reservation wrote, never goes negative and leaves
 * other keys alone is decided by the statement's WHERE, which a faked pool
 * cannot evaluate.
 */

const WINDOW_SECONDS = 3600;

async function countsFor(key: string): Promise<number[]> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT "count" FROM rate_limits WHERE key = $1 ORDER BY window_start`,
    [key],
  );
  return rows.map((r) => Number(r.count));
}

function reserve(key: string, maxAttempts: number) {
  return checkRateLimit({ key, maxAttempts, windowSeconds: WINDOW_SECONDS });
}

describeIntegration("refundRateLimitAttempt against the real table", () => {
  it("gives back the attempt the reservation counted", async () => {
    const key = unique("refund");
    await reserve(key, 3);
    await reserve(key, 3);
    await refundRateLimitAttempt(key);
    expect(await countsFor(key)).toEqual([1]);
  });

  it("keeps a full bucket of failures full, and reopens it once one is handed back", async () => {
    const key = unique("refund-full");
    for (let i = 0; i < 3; i++) await reserve(key, 3);
    expect((await reserve(key, 3)).allowed).toBe(false);
    await refundRateLimitAttempt(key);
    expect((await reserve(key, 3)).allowed).toBe(true);
  });

  it("refunded successes never accumulate toward the cap", async () => {
    const key = unique("refund-successes");
    for (let i = 0; i < 12; i++) {
      expect((await reserve(key, 10)).allowed).toBe(true);
      await refundRateLimitAttempt(key);
    }
    expect(await countsFor(key)).toEqual([0]);
  });

  it("never goes below zero and does nothing for a key with no bucket", async () => {
    const key = unique("refund-floor");
    await refundRateLimitAttempt(key);
    expect(await countsFor(key)).toEqual([]);

    await reserve(key, 3);
    await refundRateLimitAttempt(key);
    await refundRateLimitAttempt(key);
    expect(await countsFor(key)).toEqual([0]);
  });

  it("touches only the newest bucket of its own key", async () => {
    const key = unique("refund-newest");
    const other = unique("refund-other");
    const older = new Date(Date.now() - 10 * WINDOW_SECONDS * 1000);
    await pool.query(
      `INSERT INTO rate_limits (key, "count", window_start) VALUES ($1, 5, $2)`,
      [key, older],
    );
    // A fresh reservation opens the current bucket and trims the old one.
    await reserve(key, 10);
    await reserve(key, 10);
    await reserve(other, 10);

    await refundRateLimitAttempt(key);
    expect(await countsFor(key)).toEqual([1]);
    expect(await countsFor(other)).toEqual([1]);
  });
});
