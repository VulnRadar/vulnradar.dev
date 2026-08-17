// ============================================================================
// Daily Request Limit System

// Tracks and enforces daily request limits based on subscription plan
// Uses the rate_limits table for tracking (clean schema)
// When billing is disabled (config.yaml), all users get unlimited access

import pool from "@/lib/database/db";
import { BILLING_PLAN_LIMITS } from "@/lib/config/constants";
import type { SettingKey } from "@/lib/config/registry";
import { getSetting, getSettings } from "@/lib/config/runtime-config";

// Staff roles that get resolved to the "staff" plan tag below (see
// getUserPlan) -- NOT unlimited access. getDailyLimit resolves that tag to
// the Pro Supporter plan's real numeric caps, same as a paying account.
// Exported so lib/billing/staff-plan.ts's role-transition grant/revoke
// logic uses the exact same staff-role set as the dynamic-limits resolver
// here, rather than a second hardcoded copy that could drift from this one.
// Deliberately excludes super_admin: it's un-assignable through the admin
// panel (app/api/v3/admin/route.ts's set_role), so it never appears in a
// role-change event either helper needs to react to.
export const STAFF_ROLES = [
  "admin",
  "moderator",
  "support",
  "billing",
  "security_analyst",
  "content_manager",
  "ops",
];

// Plan-based daily limits (shipped defaults). Prefer getDailyLimit() over
// reading this object directly: it resolves the live admin-configured
// values through the settings resolver, this is only the fallback table.
// staff mirrors pro_supporter here for the same reason getDailyLimit
// substitutes "pro_supporter" for a "staff" plan tag: staff are capped at
// the Pro Supporter plan's limits, not unlimited.
export const PLAN_LIMITS = {
  free: BILLING_PLAN_LIMITS.free,
  core_supporter: BILLING_PLAN_LIMITS.core_supporter,
  pro_supporter: BILLING_PLAN_LIMITS.pro_supporter,
  elite_supporter: BILLING_PLAN_LIMITS.elite_supporter,
  staff: BILLING_PLAN_LIMITS.pro_supporter,
} as const;

export type PlanType = keyof typeof PLAN_LIMITS;

/** Registry key holding each plan's admin-editable daily scan cap. */
const PLAN_LIMIT_SETTING_KEYS: Record<
  Exclude<PlanType, "staff">,
  SettingKey
> = {
  free: "BILLING_FREE_LIMIT",
  core_supporter: "BILLING_CORE_SUPPORTER_LIMIT",
  pro_supporter: "BILLING_PRO_SUPPORTER_LIMIT",
  elite_supporter: "BILLING_ELITE_SUPPORTER_LIMIT",
};

/**
 * Check if billing is enabled.
 * Resolves the live admin-configured value (database row -> env override ->
 * shipped default). When disabled, all users get unlimited access (or the
 * configured unlimited_mode_limit).
 */
export async function isBillingEnabled(): Promise<boolean> {
  return getSetting("BILLING_ENABLED");
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

    // Staff roles are tagged "staff" -- callers (getDailyLimit,
    // getUserPlanLimits, userMeetsScheduleFrequency) resolve that tag to
    // the Pro Supporter plan's real limits, not unlimited.
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
 * Get user's daily limit based on their plan.
 * Resolves BILLING_ENABLED, the unlimited-mode cap, and the per-plan scan
 * caps through the admin settings resolver, so an admin edit in /admin
 * takes effect (within the resolver's cache TTL) without a deploy.
 * When billing is disabled, returns unlimited (-1 means Infinity internally)
 */
export async function getDailyLimit(userId: number): Promise<number> {
  // getSettings' return type widens to a union across every key requested
  // (not narrowed per-key), so pin the two values to their known registry
  // types (bool, int) explicitly rather than fighting the generic.
  const settings = await getSettings([
    "BILLING_ENABLED",
    "BILLING_UNLIMITED_MODE_LIMIT",
  ] as const);
  const billingEnabled = Boolean(settings.BILLING_ENABLED);
  const unlimitedModeLimit = Number(settings.BILLING_UNLIMITED_MODE_LIMIT);

  // When billing is disabled, everyone gets unlimited (or the configured limit)
  if (!billingEnabled) {
    return unlimitedModeLimit === -1 ? Infinity : unlimitedModeLimit;
  }

  const plan = await getUserPlan(userId);

  // Staff are capped at the Pro Supporter plan's limits, not unlimited --
  // substitute the real plan id and fall through to the same setting-key
  // lookup a real Pro Supporter account would use.
  const effectivePlan = plan === "staff" ? "pro_supporter" : plan;

  // Cast defensively: getUserPlan can return an unrecognized plan string
  // (e.g. a stale/custom value in the database), so fall back to the free
  // plan's setting the same way the old PLAN_LIMITS[plan] || PLAN_LIMITS.free
  // lookup did.
  const settingKey =
    (PLAN_LIMIT_SETTING_KEYS as Record<string, SettingKey>)[effectivePlan] ??
    PLAN_LIMIT_SETTING_KEYS.free;
  return Number(await getSetting(settingKey));
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
 * concurrent requests race past the limit. A later "fixed" version moved to
 * a single INSERT ... ON CONFLICT DO UPDATE statement, but the UPDATE had
 * no WHERE guard — it always incremented, THEN checked whether the new
 * total exceeded the cap. That meant a request rejected for being over
 * quota still permanently burned a slot: at 25/25, one more attempt showed
 * 26/25 forever, even though the scan itself never ran. This version adds
 * `WHERE rate_limits."count" < $2` to the ON CONFLICT DO UPDATE clause, so
 * the increment itself is skipped (not just the response's `allowed` flag)
 * once the caller is already at/over the cap — Postgres returns zero rows
 * from the CTE in that case, which the code below reads as "already at
 * cap, don't touch the counter" and re-reads the untouched current count
 * to report back accurately.
 */
export async function checkAndRecordRequest(userId: number): Promise<{
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
}> {
  // Resolve the limit first. Staff now resolve to the Pro Supporter
  // plan's real numeric cap (see getDailyLimit), not Infinity -- only a
  // genuinely disabled billing system still resolves to Infinity here.
  const limit = await getDailyLimit(userId);
  const unlimited = limit === Infinity;

  const key = `daily_scan:${userId}`;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetsAt = tomorrow.toISOString();

  // No real plan currently ships a 0 (or negative) dailyScans cap, but
  // guard it explicitly anyway: the INSERT path below has no cap check of
  // its own (a fresh day's first row is always written), so without this
  // guard a 0-limit plan's very first attempt of the day would still
  // increment once before being rejected.
  if (!unlimited && limit <= 0) {
    return { allowed: false, used: 0, limit, remaining: 0, resetsAt };
  }

  if (unlimited) {
    try {
      const result = await pool.query<{ new_count: string }>(
        `INSERT INTO rate_limits (key, "count", window_start)
         VALUES ($1, 1, date_trunc('day', NOW()))
         ON CONFLICT (key, window_start)
         DO UPDATE SET "count" = rate_limits."count" + 1
         RETURNING "count" AS new_count`,
        [key],
      );
      const newTotal = Number(result.rows[0]?.new_count ?? 0);
      return {
        allowed: true,
        used: newTotal,
        limit: -1,
        remaining: -1,
        resetsAt,
      };
    } catch (error) {
      console.error(
        "[DailyLimits] Error atomically incrementing daily count:",
        error,
      );
      return { allowed: false, used: 0, limit: -1, remaining: -1, resetsAt };
    }
  }

  try {
    // Atomically: ensure a row exists for today, increment it ONLY if
    // still under the cap, and return the new total. The WHERE clause on
    // DO UPDATE means a caller already at/over the cap gets zero rows back
    // instead of a phantom increment — no TOCTOU window between the check
    // and the write either way, since it's still one statement.
    const result = await pool.query<{ new_count: string }>(
      `WITH ins AS (
         INSERT INTO rate_limits (key, "count", window_start)
         VALUES ($1, 1, date_trunc('day', NOW()))
         ON CONFLICT (key, window_start)
         DO UPDATE SET "count" = rate_limits."count" + 1
         WHERE rate_limits."count" < $2
         RETURNING "count"
       )
       SELECT "count" AS new_count FROM ins`,
      [key, limit],
    );

    if (result.rows.length === 0) {
      // Already at/over cap: the WHERE guard skipped the increment
      // entirely. Re-read the real (untouched) current count so the
      // caller sees an accurate used/remaining instead of a guess.
      const current = await pool.query<{ count: number }>(
        `SELECT "count" FROM rate_limits
         WHERE key = $1 AND window_start = date_trunc('day', NOW())`,
        [key],
      );
      const used = current.rows[0]?.count ?? limit;
      return { allowed: false, used, limit, remaining: 0, resetsAt };
    }

    const newTotal = Number(result.rows[0].new_count);
    return {
      allowed: true,
      used: newTotal,
      limit,
      remaining: Math.max(0, limit - newTotal),
      resetsAt,
    };
  } catch (error) {
    console.error(
      "[DailyLimits] Error atomically incrementing daily count:",
      error,
    );
    // Fail closed: if we can't talk to the DB, don't issue a permit.
    return { allowed: false, used: 0, limit, remaining: limit, resetsAt };
  }
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
