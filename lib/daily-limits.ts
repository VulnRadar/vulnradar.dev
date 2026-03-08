// ============================================================================
// Daily Request Limit System
// ============================================================================
// Tracks and enforces daily request limits based on subscription plan
// ============================================================================

import pool from "./db"

// Plan-based daily limits
export const PLAN_LIMITS = {
  free: 10,
  core_supporter: 50,
  pro_supporter: 150,
  elite_supporter: 500,
  admin: Infinity, // Unlimited for admins
} as const

export type PlanType = keyof typeof PLAN_LIMITS

/**
 * Get user's current subscription plan
 */
export async function getUserPlan(userId: number): Promise<PlanType> {
  try {
    const result = await pool.query(
      `SELECT plan FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
      [userId]
    )
    if (result.rows[0]?.plan) {
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
  // Check if user is admin (admins have unlimited)
  const adminCheck = await pool.query(
    `SELECT role FROM users WHERE id = $1`,
    [userId]
  )
  if (adminCheck.rows[0]?.role === "admin") {
    return Infinity
  }

  const plan = await getUserPlan(userId)
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}

/**
 * Get current daily request count for a user
 */
export async function getDailyRequestCount(userId: number): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT request_count FROM daily_request_limits 
       WHERE user_id = $1 AND date = CURRENT_DATE`,
      [userId]
    )
    return result.rows[0]?.request_count || 0
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
    const result = await pool.query(
      `INSERT INTO daily_request_limits (user_id, date, request_count)
       VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_id, date) 
       DO UPDATE SET request_count = daily_request_limits.request_count + 1
       RETURNING request_count`,
      [userId]
    )
    return result.rows[0]?.request_count || 1
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
 * Clean up old daily limit records (run daily via cron)
 */
export async function cleanupOldLimits(daysToKeep: number = 30): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM daily_request_limits 
       WHERE date < CURRENT_DATE - INTERVAL '${daysToKeep} days'`
    )
    return result.rowCount || 0
  } catch (error) {
    console.error("[DailyLimits] Error cleaning up old limits:", error)
    return 0
  }
}

/**
 * Get usage stats for a user over time
 */
export async function getUsageStats(userId: number, days: number = 30): Promise<{
  date: string
  count: number
}[]> {
  try {
    const result = await pool.query(
      `SELECT date::text, request_count as count
       FROM daily_request_limits
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY date ASC`,
      [userId]
    )
    return result.rows
  } catch (error) {
    console.error("[DailyLimits] Error getting usage stats:", error)
    return []
  }
}
