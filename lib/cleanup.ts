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
  expired2FACodes: number
  expiredDeviceTrust: number
  expiredNotifications: number
  expiredGiftedSubs: number
  oldAuditLogs: number
  oldAdminNotes: number
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
    expired2FACodes: 0,
    expiredDeviceTrust: 0,
    expiredNotifications: 0,
    expiredGiftedSubs: 0,
    oldAuditLogs: 0,
    oldAdminNotes: 0,
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

    // Delete expired email 2FA codes
    const email2faRes = await pool.query("DELETE FROM email_2fa_codes WHERE expires_at < NOW()")
    stats.expired2FACodes = email2faRes.rowCount || 0

    // Delete expired device trust records
    const deviceTrustRes = await pool.query("DELETE FROM device_trust WHERE expires_at < NOW()")
    stats.expiredDeviceTrust = deviceTrustRes.rowCount || 0

    // Delete expired/ended admin notifications (ended more than 30 days ago)
    const notificationsRes = await pool.query(
      "DELETE FROM admin_notifications WHERE ends_at IS NOT NULL AND ends_at < NOW() - INTERVAL '30 days'"
    )
    stats.expiredNotifications = notificationsRes.rowCount || 0

    // Delete expired gifted subscriptions that ended more than 90 days ago
    const giftedSubsRes = await pool.query(
      "DELETE FROM gifted_subscriptions WHERE expires_at < NOW() - INTERVAL '90 days'"
    )
    stats.expiredGiftedSubs = giftedSubsRes.rowCount || 0

    // Delete old admin audit logs (> 1 year)
    const auditLogsRes = await pool.query(
      "DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL '365 days'"
    )
    stats.oldAuditLogs = auditLogsRes.rowCount || 0

    // Delete old admin user notes (> 1 year)
    const adminNotesRes = await pool.query(
      "DELETE FROM admin_user_notes WHERE created_at < NOW() - INTERVAL '365 days'"
    )
    stats.oldAdminNotes = adminNotesRes.rowCount || 0

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
  const total = Object.values(stats).reduce((a, b) => a + b, 0)
  if (total === 0) return "no records to clean"
  
  const items: string[] = []
  if (stats.expiredSessions > 0) items.push(`${stats.expiredSessions} sessions`)
  if (stats.oldApiUsage > 0) items.push(`${stats.oldApiUsage} API logs`)
  if (stats.revokedApiKeys > 0) items.push(`${stats.revokedApiKeys} revoked keys`)
  if (stats.oldDataRequests > 0) items.push(`${stats.oldDataRequests} data requests`)
  if (stats.oldScans > 0) items.push(`${stats.oldScans} old scans`)
  if (stats.oldRateLimits > 0) items.push(`${stats.oldRateLimits} rate limits`)
  if (stats.expiredTokens > 0) items.push(`${stats.expiredTokens} tokens`)
  if (stats.expiredInvites > 0) items.push(`${stats.expiredInvites} invites`)
  if (stats.expired2FACodes > 0) items.push(`${stats.expired2FACodes} 2FA codes`)
  if (stats.expiredDeviceTrust > 0) items.push(`${stats.expiredDeviceTrust} device trusts`)
  if (stats.expiredNotifications > 0) items.push(`${stats.expiredNotifications} notifications`)
  if (stats.expiredGiftedSubs > 0) items.push(`${stats.expiredGiftedSubs} gifted subs`)
  if (stats.oldAuditLogs > 0) items.push(`${stats.oldAuditLogs} audit logs`)
  if (stats.oldAdminNotes > 0) items.push(`${stats.oldAdminNotes} admin notes`)
  
  return `${total} total (${items.join(", ")})`
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
