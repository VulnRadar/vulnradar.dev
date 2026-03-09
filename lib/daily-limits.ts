// ============================================================================
// Daily Request Limit System
// ============================================================================
// Tracks and enforces daily request limits based on subscription plan
// Uses the rate_limits table for tracking (clean schema)
// ============================================================================

import pool from "./db"

// Plan-based daily limits
export const PLAN_LIMITS = {
  free: 50,
  core_supporter: 100,
  pro_supporter: 150,
  elite_supporter: 500,
  admin: Infinity, // Unlimited for admins
} as const

export type PlanType = keyof typeof PLAN_LIMITS

/**
 * Get user's current subscription plan (from users table)
 */
export async function getUserPlan(userId: number): Promise<PlanType> {
  try {
    const result = await pool.query(
      `SELECT plan, role FROM users WHERE id = $1`,
      [userId]
    )
    // Admins get unlimited
    if (result.rows[0]?.role === "admin") {
      return "admin"
    }
    if (result.rows[0]?.plan && result.rows[0].plan !== "free") {
      return result.rows[0].plan as PlanType
    }
    return "free"
  } catch (error) {
    console.error("[DailyLimits] Error getting user plan:", error)
    return "free"
  }
}

/**
 * Get user's daily limit based on their plan
 */
export async function getDailyLimit(userId: number): Promise<number> {
  const plan = await getUserPlan(userId)
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}

/**
 * Get current daily request count for a user (using rate_limits table)
 */
export async function getDailyRequestCount(userId: number): Promise<number> {
  try {
    const key = `daily_scan:${userId}`
    const result = await pool.query(
      `SELECT SUM("count") as total FROM rate_limits 
       WHERE key = $1 AND window_start >= CURRENT_DATE`,
      [key]
    )
    return parseInt(result.rows[0]?.total || "0", 10)
  } catch (error) {
    console.error("[DailyLimits] Error getting request count:", error)
    return 0
  }
}

/**
 * Increment daily request count for a user
 * Returns the new count
 */
export async function incrementDailyCount(userId: number): Promise<number> {
  try {
    const key = `daily_scan:${userId}`
    await pool.query(
      `INSERT INTO rate_limits (key, "count", window_start)
       VALUES ($1, 1, CURRENT_TIMESTAMP)
       ON CONFLICT (key, window_start) 
       DO UPDATE SET "count" = rate_limits."count" + 1`,
      [key]
    )
    return await getDailyRequestCount(userId)
  } catch (error) {
    console.error("[DailyLimits] Error incrementing count:", error)
    return 0
  }
}

/**
 * Check if user can make a request (has remaining daily quota)
 */
export async function canMakeRequest(userId: number): Promise<{
  allowed: boolean
  used: number
  limit: number
  remaining: number
  resetsAt: string
}> {
  const [limit, used] = await Promise.all([
    getDailyLimit(userId),
    getDailyRequestCount(userId)
  ])

  // Calculate reset time (midnight UTC)
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  tomorrow.setUTCHours(0, 0, 0, 0)
  const resetsAt = tomorrow.toISOString()

  const remaining = Math.max(0, limit - used)
  const allowed = limit === Infinity || used < limit

  return {
    allowed,
    used,
    limit: limit === Infinity ? -1 : limit, // -1 indicates unlimited
    remaining: limit === Infinity ? -1 : remaining,
    resetsAt,
  }
}

/**
 * Record a request and check if allowed
 * Returns rate limit info including whether the request was allowed
 */
export async function checkAndRecordRequest(userId: number): Promise<{
  allowed: boolean
  used: number
  limit: number
  remaining: number
  resetsAt: string
}> {
  const check = await canMakeRequest(userId)
  
  if (check.allowed) {
    const newCount = await incrementDailyCount(userId)
    return {
      ...check,
      used: newCount,
      remaining: check.limit === -1 ? -1 : Math.max(0, check.limit - newCount),
    }
  }
  
  return check
}

/**
 * Get rate limit headers for API responses
 */
export function getRateLimitHeaders(rateInfo: {
  used: number
  limit: number
  remaining: number
  resetsAt: string
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": rateInfo.limit === -1 ? "unlimited" : String(rateInfo.limit),
    "X-RateLimit-Remaining": rateInfo.remaining === -1 ? "unlimited" : String(rateInfo.remaining),
    "X-RateLimit-Used": String(rateInfo.used),
    "X-RateLimit-Reset": rateInfo.resetsAt,
    "X-RateLimit-Policy": "daily",
  }
}

/**
 * Clean up old rate limit records (run daily via cron)
 */
export async function cleanupOldLimits(daysToKeep: number = 7): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM rate_limits 
       WHERE window_start < NOW() - INTERVAL '${daysToKeep} days'`
    )
    return result.rowCount || 0
  } catch (error) {
    console.error("[DailyLimits] Error cleaning up old limits:", error)
    return 0
  }
}

/**
 * Get usage stats for a user over time (using scan_history)
 */
export async function getUsageStats(userId: number, days: number = 30): Promise<{
  date: string
  count: number
}[]> {
  try {
    const result = await pool.query(
      `SELECT DATE(scanned_at)::text as date, COUNT(*) as count
       FROM scan_history
       WHERE user_id = $1 AND scanned_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(scanned_at)
       ORDER BY date ASC`,
      [userId]
    )
    return result.rows
  } catch (error) {
    console.error("[DailyLimits] Error getting usage stats:", error)
    return []
  }
}
