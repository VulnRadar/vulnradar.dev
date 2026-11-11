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
 * `reservedBefore` is a time taken just before the checkRateLimit call, and
 * only a bucket that had started by then is eligible. The newest bucket for
 * the key is not enough on its own: a request that reserves late in one
 * window and refunds after the boundary would otherwise take the attempt out
 * of the NEXT window, which by then may hold somebody's wrong guesses, so a
 * caller timing no-password requests across the rollover could cancel
 * guesses as they were made. The bucket the reservation wrote started at or
 * before the moment it was taken; every later bucket starts after it. When
 * the reservation itself landed in a bucket that opened between that time
 * and the upsert, nothing current matches and the attempt stays counted,
 * which errs toward the cap.
 *
 * Never goes below zero. Best-effort, like resetRateLimit: the caller is on a
 * success path, and a refund that fails only leaves the count one higher than
 * it should be.
 */
export async function refundRateLimitAttempt(
  key: string,
  reservedBefore: Date,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE rate_limits SET "count" = "count" - 1
        WHERE key = $1
          AND "count" > 0
          AND window_start = (
            SELECT MAX(window_start) FROM rate_limits
             WHERE key = $1 AND window_start <= $2
          )`,
      [key, reservedBefore],
    );
  } catch (err) {
    console.error("[rate-limit] failed to refund an attempt:", err);
  }
}
