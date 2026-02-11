import pool from "@/lib/db"
import { getClientIp } from "./request-utils"
import { RATE_LIMITS as RATE_LIMIT_CONFIGS } from "./constants"

interface RateLimitConfig {
  key: string
  maxAttempts: number
  windowSeconds: number
}

interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export async function checkRateLimit({ key, maxAttempts, windowSeconds }: RateLimitConfig): Promise<RateLimitResult> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - windowSeconds * 1000)

  // Cleanup old entries
  await pool.query("DELETE FROM rate_limits WHERE window_start < $1", [windowStart])

  // Get current count for this key within the window
  const result = await pool.query(
      "SELECT id, \"count\", window_start FROM rate_limits WHERE key = $1 AND window_start >= $2 ORDER BY window_start DESC LIMIT 1",
      [key, windowStart],
  )

  if (result.rows.length === 0) {
    // First attempt in this window - delete any stale row for this key, then insert fresh
    await pool.query("DELETE FROM rate_limits WHERE key = $1", [key])
    await pool.query(
        "INSERT INTO rate_limits (key, \"count\", window_start) VALUES ($1, 1, $2)",
        [key, now],
    )
    return { allowed: true, remaining: maxAttempts - 1, retryAfterSeconds: 0 }
  }

  const row = result.rows[0]
  const count = Number(row.count)

  if (count >= maxAttempts) {
    const windowEnd = new Date(new Date(row.window_start).getTime() + windowSeconds * 1000)
    const retryAfter = Math.ceil((windowEnd.getTime() - now.getTime()) / 1000)
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(0, retryAfter) }
  }

  // Increment
  await pool.query("UPDATE rate_limits SET \"count\" = \"count\" + 1 WHERE id = $1", [row.id])
  return { allowed: true, remaining: maxAttempts - count - 1, retryAfterSeconds: 0 }
}

/**
 * @deprecated Use getClientIp from request-utils instead
 */
export async function getClientIP(): Promise<string> {
  return getClientIp()
}

// Export rate limit configs from constants
export const RATE_LIMITS = RATE_LIMIT_CONFIGS
