/**
 * Database cleanup utilities
 * Handles automatic cleanup of expired records and old data
 */
import pool from "@/lib/db"

export interface CleanupStats {
  expiredSessions: number
  oldApiUsage: number
  revokedApiKeys: number
  oldDataRequests: number
  oldScans: number
  oldRateLimits: number
  expiredTokens: number
  expiredInvites: number
}

/**
 * Execute database cleanup operations
 * Removes expired and old records to maintain database health
 */
export async function performDatabaseCleanup(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    expiredSessions: 0,
    oldApiUsage: 0,
    revokedApiKeys: 0,
    oldDataRequests: 0,
    oldScans: 0,
    oldRateLimits: 0,
    expiredTokens: 0,
    expiredInvites: 0,
  }

  try {
    // Delete expired sessions
    const sessionsRes = await pool.query("DELETE FROM sessions WHERE expires_at < NOW()")
    stats.expiredSessions = sessionsRes.rowCount || 0

    // Delete old API usage logs (> 90 days)
    const apiUsageRes = await pool.query("DELETE FROM api_usage WHERE used_at < NOW() - INTERVAL '90 days'")
    stats.oldApiUsage = apiUsageRes.rowCount || 0

    // Delete revoked API keys older than 30 days
    const revokedKeysRes = await pool.query(
      "DELETE FROM api_keys WHERE revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days'"
    )
    stats.revokedApiKeys = revokedKeysRes.rowCount || 0

    // Delete old data requests (> 60 days)
    const dataReqRes = await pool.query(
      "DELETE FROM data_requests WHERE requested_at < NOW() - INTERVAL '60 days'"
    )
    stats.oldDataRequests = dataReqRes.rowCount || 0

    // Delete old scan history (> 90 days)
    const scansRes = await pool.query("DELETE FROM scan_history WHERE scanned_at < NOW() - INTERVAL '90 days'")
    stats.oldScans = scansRes.rowCount || 0

    // Delete old rate limit records (> 1 day)
    const rateLimitsRes = await pool.query("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'")
    stats.oldRateLimits = rateLimitsRes.rowCount || 0

    // Delete expired password reset and verification tokens
    const tokensRes = await pool.query("DELETE FROM password_reset_tokens WHERE expires_at < NOW()")
    stats.expiredTokens = tokensRes.rowCount || 0

    const verifyTokensRes = await pool.query("DELETE FROM email_verification_tokens WHERE expires_at < NOW()")
    stats.expiredTokens += verifyTokensRes.rowCount || 0

    // Delete expired team invites that were never accepted
    const invitesRes = await pool.query(
      "DELETE FROM team_invites WHERE expires_at < NOW() AND accepted_at IS NULL"
    )
    stats.expiredInvites = invitesRes.rowCount || 0

    return stats
  } catch (error) {
    console.error("[Database Cleanup] Error during cleanup:", error)
    throw error
  }
}

/**
 * Format cleanup stats into a readable log message
 */
export function formatCleanupStats(stats: CleanupStats): string {
  const items = [
    `${stats.expiredSessions} expired sessions`,
    `${stats.oldApiUsage} old API usage records`,
    `${stats.revokedApiKeys} revoked API keys`,
    `${stats.oldDataRequests} old data requests`,
    `${stats.oldScans} old scans`,
    `${stats.oldRateLimits} old rate limit records`,
    `${stats.expiredTokens} expired tokens`,
    `${stats.expiredInvites} expired invites`,
  ]
  return items.join(", ")
}

/**
 * Schedule cleanup to run every 24 hours
 * Starts after initial delay to not overload startup
 */
export function schedulePeriodicCleanup(initialDelayMs: number = 60000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const stats = await performDatabaseCleanup()
      console.log(`[Database Cleanup] Periodic cleanup completed: ${formatCleanupStats(stats)}`)
    } catch (error) {
      console.error("[Database Cleanup] Periodic cleanup failed:", error)
    }
  }, 24 * 60 * 60 * 1000) // Run every 24 hours
}
