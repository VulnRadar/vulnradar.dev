import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES, APP_VERSION } from "@/lib/constants"

const COOLDOWN_DAYS = 30

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  try {
    // Get most recent download
    const result = await pool.query(
      `SELECT data, downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
      [session.userId],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ hasData: false, canDownloadNew: true, lastDownloadAt: null })
    }

    const lastDownload = new Date(result.rows[0].downloaded_at)
    const cooldownEnd = new Date(lastDownload.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    const canDownloadNew = new Date() >= cooldownEnd

    return NextResponse.json({
      hasData: true,
      canDownloadNew,
      lastDownloadAt: lastDownload.toISOString(),
      cooldownEndsAt: cooldownEnd.toISOString(),
      data: result.rows[0].data,
    })
  } catch (error) {
    return NextResponse.json({ hasData: false, canDownloadNew: true, lastDownloadAt: null })
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  // Check if they can request new data (30-day cooldown)
  const lastExport = await pool.query(
    `SELECT downloaded_at FROM data_requests WHERE user_id = $1 AND downloaded_at IS NOT NULL ORDER BY downloaded_at DESC LIMIT 1`,
    [session.userId],
  )

  if (lastExport.rows.length > 0) {
    const lastDownload = new Date(lastExport.rows[0].downloaded_at)
    const cooldownEnd = new Date(lastDownload.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    if (new Date() < cooldownEnd) {
      const daysRemaining = Math.ceil((cooldownEnd.getTime() - new Date().getTime()) / (24 * 60 * 60 * 1000))
      return NextResponse.json(
        { error: `You can request fresh data once every ${COOLDOWN_DAYS} days. Try again in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}.` },
        { status: 429 },
      )
    }
  }

  try {
    // Gather ALL user data from every table
    const [
      userData,
      sessionsData,
      apiKeysData,
      apiUsageData,
      scanHistoryData,
      scanTagsData,
      scheduledScansData,
      webhooksData,
      userBadgesData,
      billingHistoryData,
      discordConnectionData,
      deviceTrustData,
      notificationPrefsData,
      teamMembershipsData,
      teamsOwnedData,
      teamInvitesSentData,
      giftedSubscriptionsData,
      adminNotesOnUserData,
    ] = await Promise.all([
      // Core user data (excluding password_hash, totp_secret, backup_codes for security)
      pool.query(`
        SELECT id, email, name, avatar_url, discord_id, role, plan, 
               stripe_customer_id, subscription_status, current_period_end, cancel_at_period_end,
               beta_access, daily_scan_limit, email_verified_at, tos_accepted_at, disabled_at,
               onboarding_completed, totp_enabled, two_factor_method, created_at, updated_at
        FROM users WHERE id = $1
      `, [session.userId]),
      
      // Sessions
      pool.query(`
        SELECT id, ip_address, user_agent, expires_at, created_at
        FROM sessions WHERE user_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // API Keys (excluding key_hash and key_encrypted for security)
      pool.query(`
        SELECT id, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at
        FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // API Usage
      pool.query(`
        SELECT au.id, au.used_at, ak.key_prefix, ak.name as key_name
        FROM api_usage au
        JOIN api_keys ak ON au.api_key_id = ak.id
        WHERE ak.user_id = $1
        ORDER BY au.used_at DESC
      `, [session.userId]),
      
      // Scan History (full data including findings)
      pool.query(`
        SELECT id, url, summary, findings, findings_count, duration, source, 
               share_token, response_headers, notes, scanned_at
        FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC
      `, [session.userId]),
      
      // Scan Tags
      pool.query(`
        SELECT st.id, st.scan_id, st.tag, sh.url as scan_url
        FROM scan_tags st
        JOIN scan_history sh ON st.scan_id = sh.id
        WHERE st.user_id = $1 ORDER BY st.id DESC
      `, [session.userId]),
      
      // Scheduled Scans
      pool.query(`
        SELECT id, url, frequency, active, last_run_at, next_run_at, created_at
        FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // Webhooks
      pool.query(`
        SELECT id, url, name, type, active, created_at
        FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // User Badges
      pool.query(`
        SELECT ub.awarded_at, b.name as badge_name, b.display_name, b.description, b.icon, b.color
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = $1 ORDER BY ub.awarded_at DESC
      `, [session.userId]),
      
      // Billing History
      pool.query(`
        SELECT id, stripe_invoice_id, stripe_payment_intent_id, amount_cents, currency, 
               status, description, invoice_pdf_url, created_at
        FROM billing_history WHERE user_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // Discord Connection (excluding tokens for security)
      pool.query(`
        SELECT discord_id, discord_username, discord_discriminator, discord_avatar, 
               discord_email, guild_joined, connected_at, updated_at
        FROM discord_connections WHERE user_id = $1
      `, [session.userId]),
      
      // Device Trust
      pool.query(`
        SELECT id, device_fingerprint, device_name, ip_address, user_agent, 
               last_used_at, created_at, expires_at
        FROM device_trust WHERE user_id = $1 ORDER BY last_used_at DESC
      `, [session.userId]),
      
      // Notification Preferences
      pool.query(`
        SELECT * FROM notification_preferences WHERE user_id = $1
      `, [session.userId]),
      
      // Team Memberships
      pool.query(`
        SELECT tm.role, tm.joined_at, t.name as team_name, t.slug as team_slug
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.id
        WHERE tm.user_id = $1 ORDER BY tm.joined_at DESC
      `, [session.userId]),
      
      // Teams Owned
      pool.query(`
        SELECT id, name, slug, created_at
        FROM teams WHERE owner_id = $1 ORDER BY created_at DESC
      `, [session.userId]),
      
      // Team Invites Sent
      pool.query(`
        SELECT ti.email, ti.role, ti.expires_at, ti.accepted_at, ti.created_at, t.name as team_name
        FROM team_invites ti
        JOIN teams t ON ti.team_id = t.id
        WHERE ti.invited_by = $1 ORDER BY ti.created_at DESC
      `, [session.userId]),
      
      // Gifted Subscriptions Received
      pool.query(`
        SELECT gs.plan, gs.reason, gs.expires_at, gs.revoked_at, gs.created_at,
               u.email as gifted_by_email
        FROM gifted_subscriptions gs
        LEFT JOIN users u ON gs.gifted_by = u.id
        WHERE gs.user_id = $1 ORDER BY gs.created_at DESC
      `, [session.userId]),
      
      // Admin Notes on User (user should see notes about them)
      pool.query(`
        SELECT aun.note, aun.created_at, u.email as admin_email
        FROM admin_user_notes aun
        LEFT JOIN users u ON aun.admin_id = u.id
        WHERE aun.user_id = $1 ORDER BY aun.created_at DESC
      `, [session.userId]),
    ])

    // Remove user_id from notification_preferences for cleaner export
    const notifPrefs = notificationPrefsData.rows[0] || null
    if (notifPrefs) {
      delete notifPrefs.id
      delete notifPrefs.user_id
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      dataExportVersion: APP_VERSION,
      
      // Account Information
      account: userData.rows[0] || null,
      
      // Security & Access
      sessions: sessionsData.rows,
      deviceTrust: deviceTrustData.rows,
      discordConnection: discordConnectionData.rows[0] || null,
      
      // API & Developer
      apiKeys: apiKeysData.rows,
      apiUsage: apiUsageData.rows,
      webhooks: webhooksData.rows,
      
      // Scanning
      scheduledScans: scheduledScansData.rows,
      scanTags: scanTagsData.rows,
      
      // Billing & Subscription
      billingHistory: billingHistoryData.rows,
      giftedSubscriptions: giftedSubscriptionsData.rows,
      
      // Teams
      teamsOwned: teamsOwnedData.rows,
      teamMemberships: teamMembershipsData.rows,
      teamInvitesSent: teamInvitesSentData.rows,
      
      // Profile & Preferences
      badges: userBadgesData.rows,
      notificationPreferences: notifPrefs,
      
      // Admin Notes (transparency)
      adminNotesAboutYou: adminNotesOnUserData.rows,
      
      // Scan History (placed last due to potentially large size)
      scanHistory: scanHistoryData.rows,
    }

    const jsonString = JSON.stringify(exportData, null, 2)

    // Store the data for future re-downloads
    // Perform an update first; if no rows were updated, insert a new row.
    // This avoids relying on a UNIQUE constraint for `user_id` which may not exist.
    const updateResult = await pool.query(
      `UPDATE data_requests SET data = $2, downloaded_at = NOW() WHERE user_id = $1`,
      [session.userId, jsonString],
    )

    if (updateResult.rowCount === 0) {
      await pool.query(
        `INSERT INTO data_requests (user_id, data, downloaded_at) VALUES ($1, $2, NOW())`,
        [session.userId, jsonString],
      )
    }

    return NextResponse.json({ success: true, data: exportData })
  } catch (error) {
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 })
  }
}
