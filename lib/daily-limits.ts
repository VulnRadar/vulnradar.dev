// ============================================================================
// Daily Request Limit System
// ============================================================================
// Tracks and enforces daily request limits based on subscription plan
// Uses the rate_limits table for tracking (clean schema)
// When billing is disabled (config.yaml), all users get unlimited access
// ============================================================================

import pool from "./db"
import { BILLING_ENABLED, BILLING_PLAN_LIMITS, BILLING_UNLIMITED_MODE_LIMIT } from "./constants"

// Plan-based daily limits (from config.yaml when billing is enabled)
export const PLAN_LIMITS = {
  free: BILLING_PLAN_LIMITS.free,
  core_supporter: BILLING_PLAN_LIMITS.core_supporter,
  pro_supporter: BILLING_PLAN_LIMITS.pro_supporter,
  elite_supporter: BILLING_PLAN_LIMITS.elite_supporter,
  admin: Infinity, // Unlimited for admins always
} as const

export type PlanType = keyof typeof PLAN_LIMITS

/**
 * Check if billing is enabled
 * When disabled, all users get unlimited access (or unlimited_mode_limit)
 */
export function isBillingEnabled(): boolean {
  return BILLING_ENABLED
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
      [userId]
    )
    const row = result.rows[0]
    
    // Admins get unlimited
    if (row?.role === "admin") {
      return "admin"
    }
    
    // Gifted plan takes priority over regular plan
    const effectivePlan = row?.gifted_plan || row?.plan
    if (effectivePlan && effectivePlan !== "free") {
      return effectivePlan as PlanType
    }
    return "free"
  } catch (error) {
    console.error("[DailyLimits] Error getting user plan:", error)
    return "free"
  }
}

/**
 * Get user's daily limit based on their plan
 * When billing is disabled, returns unlimited (-1 means Infinity internally)
 */
export async function getDailyLimit(userId: number): Promise<number> {
  // When billing is disabled, everyone gets unlimited (or the configured limit)
  if (!BILLING_ENABLED) {
    return BILLING_UNLIMITED_MODE_LIMIT === -1 ? Infinity : BILLING_UNLIMITED_MODE_LIMIT
  }
  
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
