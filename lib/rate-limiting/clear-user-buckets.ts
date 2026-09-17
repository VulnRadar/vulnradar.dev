import pool from "@/lib/database/db";

/**
 * Delete every rate-limit bucket belonging to one user, and say how many went.
 *
 * `rate_limits` is one shared table keyed `<name>:<userId>` or
 * `<name>:<userId>:<ip>` across every per-user limiter in the app, so "clear
 * this user's limits" is a pattern match rather than a lookup. The pattern is
 * anchored on `:` or an end of string on both sides for one reason: clearing
 * user 5 must not also clear user 50, 500 or 1500, which is a cross-tenant
 * quota reset handed to accounts that never asked for it.
 *
 * It lives here rather than inline in the admin route because that anchoring
 * is the whole of its correctness and it is Postgres, not application code,
 * that decides whether it holds. A route body cannot be pointed at a real
 * database without a session; this can, and
 * tests/integration/rate-limit-buckets.test.ts does exactly that.
 */
export async function clearUserRateLimitBuckets(
  userId: number,
): Promise<number> {
  const result = await pool.query(
    "DELETE FROM rate_limits WHERE key ~ ('(^|:)' || $1::text || '($|:)')",
    [String(userId)],
  );
  return result.rowCount ?? 0;
}
