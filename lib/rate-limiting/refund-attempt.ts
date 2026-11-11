import pool from "@/lib/database/db";

/**
 * Give back one attempt that checkRateLimit counted, for a limiter that should
 * end up counting failures only.
 *
 * The alternative, peeking first and recording only after a failure, leaves a
 * gap a burst walks through: every request in a parallel volley peeks before
 * any of them records, so all of them get a guess. Reserving through
 * checkRateLimit's guarded upsert keeps the cap atomic, and the attempts that
 * turn out not to be failures are handed back here.
 *
 * Takes the newest bucket for the key, which is the one the reservation just
 * wrote: checkRateLimit trims the older ones whenever it opens a new bucket.
 * Never goes below zero. Best-effort, like resetRateLimit: the caller is on a
 * success path, and a refund that fails only leaves the count one higher than
 * it should be.
 */
export async function refundRateLimitAttempt(key: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE rate_limits SET "count" = "count" - 1
        WHERE key = $1
          AND "count" > 0
          AND window_start = (
            SELECT MAX(window_start) FROM rate_limits WHERE key = $1
          )`,
      [key],
    );
  } catch (err) {
    console.error("[rate-limit] failed to refund an attempt:", err);
  }
}
