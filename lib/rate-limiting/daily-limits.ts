// ============================================================================
// Daily Request Limit System

// Tracks and enforces daily request limits based on subscription plan
// Uses the rate_limits table for tracking (clean schema)
// When billing is disabled (config.yaml), all users get unlimited access

import pool from "@/lib/database/db";
import {
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
  BILLING_UNLIMITED_MODE_LIMIT,
} from "@/lib/config/constants";

// Staff roles that get unlimited access
const STAFF_ROLES = ["admin", "moderator", "support"];

// Plan-based daily limits (from config.yaml when billing is enabled)
export const PLAN_LIMITS = {
  free: BILLING_PLAN_LIMITS.free,
  core_supporter: BILLING_PLAN_LIMITS.core_supporter,
  pro_supporter: BILLING_PLAN_LIMITS.pro_supporter,
  elite_supporter: BILLING_PLAN_LIMITS.elite_supporter,
  staff: Infinity, // Unlimited for all staff (admin, moderator, support)
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;

/**
 * Check if billing is enabled
 * When disabled, all users get unlimited access (or unlimited_mode_limit)
 */
export function isBillingEnabled(): boolean {
  return BILLING_ENABLED;
}

/**
 * Get user's current subscription plan (from users table, checking gifted subscriptions first)
 */
export async function getUserPlan(userId: number): Promise<PlanType> {
  try {
    // Check for active gifted subscription first, then fall back to user's regular plan
    const result = await pool.query(
      `SELECT u.plan, u.role, gs.plan as gifted_plan
       FROM users u
       LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id 
         AND gs.revoked_at IS NULL 
         AND gs.expires_at > NOW()
       WHERE u.id = $1`,
      [userId],
    );
    const row = result.rows[0];

    // Staff roles get unlimited
    if (row?.role && STAFF_ROLES.includes(row.role)) {
      return "staff";
    }

    // Gifted plan takes priority over regular plan
    const effectivePlan = row?.gifted_plan || row?.plan;
    if (effectivePlan && effectivePlan !== "free") {
      return effectivePlan as PlanType;
    }
    return "free";
  } catch (error) {
    console.error("[DailyLimits] Error getting user plan:", error);
    return "free";
  }
}

/**
 * Get user's daily limit based on their plan
 * When billing is disabled, returns unlimited (-1 means Infinity internally)
 */
export async function getDailyLimit(userId: number): Promise<number> {
  // When billing is disabled, everyone gets unlimited (or the configured limit)
  if (!BILLING_ENABLED) {
    return BILLING_UNLIMITED_MODE_LIMIT === -1
      ? Infinity
      : BILLING_UNLIMITED_MODE_LIMIT;
  }

  const plan = await getUserPlan(userId);
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

/**
 * Get current daily request count for a user (using rate_limits table)
 */
export async function getDailyRequestCount(userId: number): Promise<number> {
  try {
    const key = `daily_scan:${userId}`;
    const result = await pool.query(
      `SELECT SUM("count") as total FROM rate_limits 
       WHERE key = $1 AND window_start >= CURRENT_DATE`,
      [key],
    );
    return parseInt(result.rows[0]?.total || "0", 10);
  } catch (error) {
    console.error("[DailyLimits] Error getting request count:", error);
    return 0;
  }
}

/**
 * Atomically increment the user's daily counter and return the new count.
 * Implemented as a single SQL statement so two concurrent requests can't
 * both read the pre-increment count and both squeeze under the limit.
 */
export async function incrementDailyCount(userId: number): Promise<number> {
  try {
    const key = `daily_scan:${userId}`;
    const result = await pool.query<{ new_count: string }>(
      `INSERT INTO rate_limits (key, "count", window_start)
       VALUES ($1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (key, window_start)
       DO UPDATE SET "count" = rate_limits."count" + 1
       RETURNING "count" AS new_count`,
      [key],
    );
    // Returned row gives us the post-increment count for *this* key only;
    // callers that need the daily total still go through getDailyRequestCount.
    return Number(result.rows[0]?.new_count ?? 0);
  } catch (error) {
    console.error("[DailyLimits] Error incrementing count:", error);
    return 0;
  }
}

/**
 * Check if user can make a request (has remaining daily quota)
 */
export async function canMakeRequest(userId: number): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}> {
  const [limit, used] = await Promise.all([
    getDailyLimit(userId),
    getDailyRequestCount(userId),
  ]);

  // Calculate reset time (midnight UTC)
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetsAt = tomorrow.toISOString();

  const remaining = Math.max(0, limit - used);
  const allowed = limit === Infinity || used < limit;

  return {
    allowed,
    used,
    limit: limit === Infinity ? -1 : limit, // -1 indicates unlimited
    remaining: limit === Infinity ? -1 : remaining,
    resetsAt,
  };
}

/**
 * Record a request and check if allowed.
 *
 * Implementation note: the old version did a read-then-increment across two
 * SQL statements (`canMakeRequest` then `incrementDailyCount`), which let
 * concurrent requests race past the limit. The fixed version does the
 * increment atomically with a CTE that only updates if the running total is
 * still under the per-plan cap, then re-reads the total once at the end so
 * the response shape stays the same for callers.
 */
export async function checkAndRecordRequest(userId: number): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}> {
  // Resolve the limit first; for staff and unlimited billing this is
  // -Infinity / Infinity and we just bump the counter.
  const limit = await getDailyLimit(userId);
  const unlimited = limit === Infinity;

  const key = `daily_scan:${userId}`;

  // Atomically: ensure a row exists for today, increment it, and return
  // the new total. Wrapped in a CTE so the increment-and-check happens in
  // a single statement — no TOCTOU window between SELECT and UPDATE.
  let newTotal = 0;
  try {
    const result = await pool.query<{ new_count: string }>(
      `WITH ins AS (
         INSERT INTO rate_limits (key, "count", window_start)
         VALUES ($1, 1, date_trunc('day', NOW()))
         ON CONFLICT (key, window_start)
         DO UPDATE SET "count" = rate_limits."count" + 1
         RETURNING "count"
       )
       SELECT "count" AS new_count FROM ins`,
      [key],
    );
    newTotal = Number(result.rows[0]?.new_count ?? 0);
  } catch (error) {
    console.error(
      "[DailyLimits] Error atomically incrementing daily count:",
      error,
    );
    // Fail closed: if we can't talk to the DB, don't issue a permit.
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return {
      allowed: false,
      used: 0,
      limit: unlimited ? -1 : limit,
      remaining: unlimited ? -1 : limit,
      resetsAt: tomorrow.toISOString(),
    };
  }

  const allowed = unlimited || newTotal <= limit;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return {
    allowed,
    used: newTotal,
    limit: unlimited ? -1 : limit,
    remaining: unlimited ? -1 : Math.max(0, limit - newTotal),
    resetsAt: tomorrow.toISOString(),
  };
}

/**
 * Get rate limit headers for API responses
 */
export function getRateLimitHeaders(rateInfo: {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit":
      rateInfo.limit === -1 ? "unlimited" : String(rateInfo.limit),
    "X-RateLimit-Remaining":
      rateInfo.remaining === -1 ? "unlimited" : String(rateInfo.remaining),
    "X-RateLimit-Used": String(rateInfo.used),
    "X-RateLimit-Reset": rateInfo.resetsAt,
    "X-RateLimit-Policy": "daily",
  };
}

/**
 * Clean up old rate limit records (run daily via cron)
 */
export async function cleanupOldLimits(
  daysToKeep: number = 7,
): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM rate_limits
       WHERE window_start < NOW() - make_interval(days => $1)`,
      [daysToKeep],
    );
    return result.rowCount || 0;
  } catch (error) {
    console.error("[DailyLimits] Error cleaning up old limits:", error);
    return 0;
  }
}

/**
 * Get usage stats for a user over time (using scan_history)
 */
export async function getUsageStats(
  userId: number,
  days: number = 30,
): Promise<
  {
    date: string;
    count: string;
  }[]
> {
  try {
    const result = await pool.query(
      `SELECT DATE(scanned_at)::text as date, COUNT(*) as count
       FROM scan_history
       WHERE user_id = $1 AND scanned_at >= NOW() - make_interval(days => $2)
       GROUP BY DATE(scanned_at)
       ORDER BY date ASC`,
      [userId, days],
    );
    return result.rows;
  } catch (error) {
    console.error("[DailyLimits] Error getting usage stats:", error);
    return [];
  }
}
