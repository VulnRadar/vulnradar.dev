/**
 * Database cleanup utilities
 * Handles automatic cleanup of expired records and old data
 */
import pool from "@/lib/database/db"
import { BILLING_HISTORY_RETENTION } from "@/lib/config/constants"

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
  oldStaffActivity: number
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
    oldStaffActivity: 0,
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

    // Delete old scan history based on user's plan retention
    // Users with unlimited retention (-1) are not affected
    // Free users: 30 days, Core: 90 days, Pro/Elite: unlimited
    let totalScansDeleted = 0
    
    // Delete scans for free users (30-day retention)
    if (BILLING_HISTORY_RETENTION.free > 0) {
      const freeScansRes = await pool.query(
        `DELETE FROM scan_history 
         WHERE scanned_at < NOW() - INTERVAL '${BILLING_HISTORY_RETENTION.free} days'
         AND user_id IN (SELECT id FROM users WHERE plan = 'free' OR plan IS NULL)`
      )
      totalScansDeleted += freeScansRes.rowCount || 0
    }
    
    // Delete scans for core_supporter users (90-day retention)
    if (BILLING_HISTORY_RETENTION.core_supporter > 0) {
      const coreScansRes = await pool.query(
        `DELETE FROM scan_history 
         WHERE scanned_at < NOW() - INTERVAL '${BILLING_HISTORY_RETENTION.core_supporter} days'
         AND user_id IN (SELECT id FROM users WHERE plan = 'core_supporter')`
      )
      totalScansDeleted += coreScansRes.rowCount || 0
    }
    
    // Pro and Elite have unlimited retention (-1), so no cleanup needed for them
    
    stats.oldScans = totalScansDeleted

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

    // Revoke premium badges for users whose gifted subscriptions just expired
    // Only revoke if user doesn't have a paid plan (free plan only)
    try {
      const premiumBadge = await pool.query("SELECT id FROM badges WHERE name = 'premium' LIMIT 1")
      if (premiumBadge.rows.length > 0) {
        const badgeId = premiumBadge.rows[0].id
        // Find users with expired gifts who are on free plan and remove their premium badge
        const revokeResult = await pool.query(
          `DELETE FROM user_badges 
           WHERE badge_id = $1 
           AND user_id IN (
             SELECT DISTINCT gs.user_id 
             FROM gifted_subscriptions gs
             JOIN users u ON gs.user_id = u.id
             WHERE gs.expires_at < NOW() 
             AND gs.expires_at > NOW() - INTERVAL '1 day'
             AND gs.revoked_at IS NULL
             AND (u.plan = 'free' OR u.plan IS NULL)
             AND NOT EXISTS (
               SELECT 1 FROM gifted_subscriptions gs2 
               WHERE gs2.user_id = gs.user_id 
               AND gs2.expires_at > NOW() 
               AND gs2.revoked_at IS NULL
             )
           )`,
          [badgeId]
        )
        if (revokeResult.rowCount && revokeResult.rowCount > 0) {
          console.log(`[Database Cleanup] Revoked ${revokeResult.rowCount} premium badges from users with expired gifts`)
        }
      }
    } catch (badgeErr) {
      console.error("[Database Cleanup] Error revoking badges for expired gifts:", badgeErr)
    }

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

    // Delete old staff activity records (> 30 days)
    const staffActivityRes = await pool.query(
      "DELETE FROM staff_activity WHERE last_heartbeat < NOW() - INTERVAL '30 days'"
    )
    stats.oldStaffActivity = staffActivityRes.rowCount || 0

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
  if (stats.oldStaffActivity > 0) items.push(`${stats.oldStaffActivity} staff activity`)
  
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
