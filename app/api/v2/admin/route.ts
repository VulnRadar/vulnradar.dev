import { NextRequest, NextResponse } from "next/server"
import { randomBytes, scryptSync } from "node:crypto"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { getClientIP } from "@/lib/rate-limit"
import { ERROR_MESSAGES, STAFF_ROLES, STAFF_ROLE_HIERARCHY } from "@/lib/constants"

async function requireStaff() {
  const session = await getSession()
  if (!session) return null
  const result = await pool.query("SELECT role FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user) return null
  const role = user.role || "user"
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)) return null
  return { ...session, role }
}

async function logAction(adminId: number, targetUserId: number | null, action: string, details?: string, ip?: string) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, targetUserId, action, details || null, ip || null],
  )
}


// GET: Admin dashboard stats + user list + audit log
export async function GET(request: NextRequest) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, Number(searchParams.get("page") || 1))
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 10)))
  const offset = (page - 1) * limit
  const section = searchParams.get("section")
  const search = searchParams.get("search")?.trim() || ""

  // Fetch user detail
  if (section === "user-detail") {
    const userId = searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    const [userRes, scansRes, keysRes, webhooksRes, schedulesRes, sessionsRes, badgesRes] = await Promise.all([
      pool.query(
        `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at,
          u.plan, u.stripe_customer_id, u.subscription_status, u.beta_access,
          (SELECT COUNT(*) FROM scan_history WHERE user_id = $1)::int as scan_count,
          (SELECT COUNT(*) FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL)::int as api_key_count,
          (SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND expires_at > NOW())::int as session_count,
          (u.backup_codes IS NOT NULL AND u.backup_codes != '[]') as has_backup_codes,
          gs.plan as gifted_plan,
          gs.expires_at as gift_end_date
        FROM users u
        LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
        WHERE u.id = $1`,
        [userId],
      ),
      pool.query(
        "SELECT id, url, findings_count, source, scanned_at FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC LIMIT 10",
        [userId],
      ),
      pool.query(
        "SELECT id, key_prefix, name, daily_limit, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
        [userId],
      ),
      pool.query("SELECT id, name, url, type, active FROM webhooks WHERE user_id = $1", [userId]),
      pool.query("SELECT id, url, frequency, active, last_run_at, next_run_at FROM scheduled_scans WHERE user_id = $1", [userId]),
      pool.query("SELECT id, created_at, expires_at, ip_address, user_agent FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC", [userId]),
      pool.query(
        `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, b.is_limited, ub.awarded_at
         FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
         WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
        [userId]
      ),
    ])

    if (!userRes.rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 })

    return NextResponse.json({
      user: userRes.rows[0],
      recentScans: scansRes.rows,
      apiKeys: keysRes.rows,
      webhooks: webhooksRes.rows,
      schedules: schedulesRes.rows,
      activeSessions: sessionsRes.rows,
      badges: badgesRes.rows,
    })
  }

  // Fetch audit log
  if (section === "audit") {
    const auditLimit = limit
    const auditOffset = (page - 1) * auditLimit
    const auditRes = await pool.query(
      `SELECT al.id, al.action, al.details, al.created_at, al.ip_address,
        al.admin_id, al.target_user_id,
        au.email as admin_email, au.name as admin_name, au.avatar_url as admin_avatar_url,
        tu.email as target_email, tu.name as target_name, tu.avatar_url as target_avatar_url
      FROM admin_audit_log al
      LEFT JOIN users au ON al.admin_id = au.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      ORDER BY al.created_at DESC
      LIMIT $1 OFFSET $2`,
      [auditLimit, auditOffset],
    )
    const totalRes = await pool.query("SELECT COUNT(*)::int as count FROM admin_audit_log")
    return NextResponse.json({
      logs: auditRes.rows,
      total: totalRes.rows[0].count,
      page,
      totalPages: Math.ceil(totalRes.rows[0].count / auditLimit),
    })
  }

  // All badges list
  if (section === "badges") {
    const badgesRes = await pool.query("SELECT * FROM badges ORDER BY priority DESC, name ASC")
    return NextResponse.json({ badges: badgesRes.rows })
  }

  // Active admins
  if (section === "active-admins") {
    const adminsRes = await pool.query(`
      SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.created_at, u.totp_enabled,
        (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) as last_session_created,
        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > NOW())::int as active_sessions,
        (SELECT MAX(al.created_at) FROM admin_audit_log al WHERE al.admin_id = u.id) as last_admin_action,
        (SELECT al.action FROM admin_audit_log al WHERE al.admin_id = u.id ORDER BY al.created_at DESC LIMIT 1) as last_action_type,
        (SELECT s.ip_address FROM sessions s WHERE s.user_id = u.id ORDER BY s.created_at DESC LIMIT 1) as last_ip,
        (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id)::int as total_actions,
        (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id AND al.created_at > NOW() - INTERVAL '24 hours')::int as actions_24h,
        -- Activity tracking fields
        sa.last_heartbeat,
        sa.current_section,
        CASE WHEN sa.last_heartbeat IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat))::int ELSE NULL END as seconds_since_heartbeat,
        CASE WHEN sa.last_heartbeat IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat)) < 120 THEN true ELSE false END as is_active,
        (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id AND al.created_at > NOW() - INTERVAL '5 minutes')::int as recent_actions
      FROM users u
      LEFT JOIN staff_activity sa ON sa.user_id = u.id
      WHERE u.role IN ('admin', 'moderator', 'support')
      ORDER BY
        CASE u.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 WHEN 'support' THEN 2 END,
        last_admin_action DESC NULLS LAST
    `)
    return NextResponse.json({ admins: adminsRes.rows })
  }

  // Default: stats + user list
  const [statsResult, usersResult, totalResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM scan_history) as total_scans,
        (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL) as active_api_keys,
        (SELECT COUNT(*) FROM scheduled_scans WHERE active = true) as active_schedules,
        (SELECT COUNT(*) FROM webhooks WHERE active = true) as active_webhooks,
        (SELECT COUNT(*) FROM users WHERE totp_enabled = true) as users_with_2fa,
        (SELECT COUNT(*) FROM scan_history WHERE scanned_at > NOW() - INTERVAL '24 hours') as scans_24h,
        (SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days') as new_users_7d,
        (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) as disabled_users,
        (SELECT COUNT(*) FROM scan_history WHERE share_token IS NOT NULL) as shared_scans
    `),
    search
      ? pool.query(`
          SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at, u.plan, u.subscription_status,
            (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
            (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count,
            gs.plan as gifted_plan,
            gs.expires_at as gift_end_date
          FROM users u
          LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
          WHERE u.email ILIKE $3 OR u.name ILIKE $3
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset, `%${search}%`])
      : pool.query(`
          SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at, u.plan, u.subscription_status,
            (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
            (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count,
            gs.plan as gifted_plan,
            gs.expires_at as gift_end_date
          FROM users u
          LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset]),
    search
      ? pool.query("SELECT COUNT(*) FROM users WHERE email ILIKE $1 OR name ILIKE $1", [`%${search}%`])
      : pool.query("SELECT COUNT(*) FROM users"),
  ])

  return NextResponse.json({
    stats: statsResult.rows[0],
    users: usersResult.rows,
    total: Number(totalResult.rows[0].count),
    page,
    totalPages: Math.ceil(Number(totalResult.rows[0].count) / limit),
    callerRole: session.role,
  })
}

// Permission helpers per role
// Admin: all actions
// Moderator: disable/enable, revoke_sessions, revoke_api_keys, delete_scans, clear_rate_limits, verify_email, add_note, clear_avatar
// Support: view only (no PATCH actions)
function canPerformAction(role: string, action: string): boolean {
  const adminOnly = [
    "make_admin", "remove_admin", "set_role", "delete", "reset_password", 
    "award_badge", "revoke_badge", "create_badge", "delete_badge",
    "update_email", "update_plan",
    "toggle_beta_access", "impersonate", "set_scan_limit", "export_data"
  ]
  const modActions = [
    "award_badge", "revoke_badge", "create_badge", "delete_badge",
    "update_name", "update_email", "verify_email",
    "revoke_sessions", "revoke_api_keys", "toggle_beta_access",
    "delete_scans", "delete_webhooks", "delete_schedules",
    "clear_rate_limits", "verify_email", "unverify_email",
    "force_logout_all", "add_note", "clear_avatar", "update_name",
    "reset_2fa", "send_notification", "gift_subscription", "revoke_gift"
  ]
  if (role === STAFF_ROLES.ADMIN) return true
  if (role === STAFF_ROLES.MODERATOR) return modActions.includes(action)
  return false // support = view only
}

// PATCH: Admin actions on users
export async function PATCH(request: NextRequest) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 })

  const ip = await getClientIP()
  const { action, userId, role: newRole, badgeId, name: badgeName, displayName, color: badgeColor, name, email, plan, giftPlan, giftEndDate } = await request.json()

  if (!userId || !action) {
    return NextResponse.json({ error: "Missing action or userId" }, { status: 400 })
  }

  // Check role-based permissions
  if (!canPerformAction(session.role, action)) {
    return NextResponse.json({ error: "You don't have permission to perform this action." }, { status: 403 })
  }

  // Protect the owner account (user ID 1) from any modifications
  if (userId === 1 && session.userId !== 1) {
    return NextResponse.json({ error: "This account is protected and cannot be modified." }, { status: 403 })
  }

  // Prevent self-modification for dangerous actions
  if (userId === session.userId && ["remove_admin", "delete", "disable", "reset_password", "set_role"].includes(action)) {
    return NextResponse.json({ error: "Cannot perform this action on your own account." }, { status: 400 })
  }

  // Get target user for logging
  const targetRes = await pool.query("SELECT email, totp_enabled, role FROM users WHERE id = $1", [userId])
  if (!targetRes.rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const targetUser = targetRes.rows[0]

  // Moderators cannot act on admins or other moderators
  if (session.role === STAFF_ROLES.MODERATOR && (STAFF_ROLE_HIERARCHY[targetUser.role] || 0) >= (STAFF_ROLE_HIERARCHY[STAFF_ROLES.MODERATOR] || 2)) {
    return NextResponse.json({ error: "You cannot perform actions on users with equal or higher roles." }, { status: 403 })
  }

  switch (action) {
    case "set_role": {
      const validRoles = Object.values(STAFF_ROLES)
      if (!newRole || !validRoles.includes(newRole)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 })
      }
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [newRole, userId])
      await logAction(session.userId, userId, "set_role", `Changed role of ${targetUser.email} from ${targetUser.role} to ${newRole}`, ip)
      return NextResponse.json({ success: true })
    }

    case "make_admin":
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId])
      await logAction(session.userId, userId, "make_admin", `Granted admin to ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })

    case "remove_admin":
      await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [userId])
      await logAction(session.userId, userId, "remove_admin", `Removed admin from ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })

    case "reset_password": {
      if (targetUser.totp_enabled) {
        return NextResponse.json({
          error: "Cannot reset password for users with 2FA enabled. The user must disable 2FA first, or use their backup codes to regain access.",
        }, { status: 400 })
      }
      const tempPassword = randomBytes(6).toString("base64url").slice(0, 12)
      const salt = randomBytes(16).toString("hex")
      const hash = scryptSync(tempPassword, salt, 64).toString("hex")
      const passwordHash = `${salt}:${hash}`
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, userId])
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "reset_password", `Reset password for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true, tempPassword })
    }

    case "revoke_sessions":
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "revoke_sessions", `Revoked all sessions for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })

    case "revoke_api_keys": {
      await pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [userId])
      await logAction(session.userId, userId, "revoke_api_keys", `Revoked all API keys for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "disable": {
      await pool.query("UPDATE users SET disabled_at = NOW() WHERE id = $1", [userId])
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "disable_user", `Disabled account for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "enable": {
      await pool.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [userId])
      await logAction(session.userId, userId, "enable_user", `Re-enabled account for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "delete":
      await pool.query("DELETE FROM users WHERE id = $1", [userId])
      await logAction(session.userId, userId, "delete_user", `Deleted account ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })

    case "award_badge": {
      if (!badgeId) return NextResponse.json({ error: "badgeId required" }, { status: 400 })
      await pool.query(
        "INSERT INTO user_badges (user_id, badge_id, awarded_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [userId, badgeId, session.userId]
      )
      const badge = await pool.query("SELECT display_name FROM badges WHERE id = $1", [badgeId])
      await logAction(session.userId, userId, "award_badge", `Awarded badge "${badge.rows[0]?.display_name}" to ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "revoke_badge": {
      if (!badgeId) return NextResponse.json({ error: "badgeId required" }, { status: 400 })
      const badge = await pool.query("SELECT display_name FROM badges WHERE id = $1", [badgeId])
      await pool.query("DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2", [userId, badgeId])
      await logAction(session.userId, userId, "revoke_badge", `Revoked badge "${badge.rows[0]?.display_name}" from ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "create_badge": {
      if (!badgeName || !displayName) return NextResponse.json({ error: "name and displayName required" }, { status: 400 })
      const slug = badgeName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
      // Check for case-insensitive duplicate
      const existing = await pool.query("SELECT id, display_name FROM badges WHERE LOWER(name) = LOWER($1)", [slug])
      if (existing.rows.length > 0) {
        return NextResponse.json({ 
          error: `Badge "${existing.rows[0].display_name}" already exists. Delete it first if you want to recreate it with different settings.` 
        }, { status: 409 })
      }
      const newBadge = await pool.query(
        "INSERT INTO badges (name, display_name, color) VALUES ($1, $2, $3) RETURNING id",
        [slug, displayName, badgeColor || "#6366f1"]
      )
      const newBadgeId = newBadge.rows[0].id
      await pool.query(
        "INSERT INTO user_badges (user_id, badge_id, awarded_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [userId, newBadgeId, session.userId]
      )
      await logAction(session.userId, userId, "create_badge", `Created and awarded badge "${displayName}" to ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "update_name": {
      if (!name || typeof name !== "string") return NextResponse.json({ error: "name required" }, { status: 400 })
      const safeName = name.trim().slice(0, 100)
      const oldName = await pool.query("SELECT name FROM users WHERE id = $1", [userId])
      await pool.query("UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2", [safeName, userId])
      await logAction(session.userId, userId, "update_name", `Changed name for ${targetUser.email} from "${oldName.rows[0]?.name || ''}" to "${safeName}"`, ip)
      return NextResponse.json({ success: true })
    }

    case "update_email": {
      if (!email || typeof email !== "string") return NextResponse.json({ error: "email required" }, { status: 400 })
      const safeEmail = email.trim().toLowerCase().slice(0, 255)
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(safeEmail)) return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
      // Check if email is already in use
      const existing = await pool.query("SELECT id FROM users WHERE email = $1 AND id != $2", [safeEmail, userId])
      if (existing.rows.length > 0) return NextResponse.json({ error: "Email already in use by another account" }, { status: 400 })
      const oldEmail = targetUser.email
      await pool.query("UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2", [safeEmail, userId])
      await logAction(session.userId, userId, "update_email", `Changed email from "${oldEmail}" to "${safeEmail}"`, ip)
      return NextResponse.json({ success: true })
    }

    case "update_plan": {
      const validPlans = ["free", "core_supporter", "pro_supporter", "elite_supporter"]
      if (!plan || !validPlans.includes(plan)) {
        return NextResponse.json({ error: "Invalid plan. Must be one of: " + validPlans.join(", ") }, { status: 400 })
      }
      // Update user's plan directly in users table
      await pool.query(
        "UPDATE users SET plan = $1, subscription_status = $2, updated_at = NOW() WHERE id = $3",
        [plan, plan === "free" ? null : "active", userId]
      )
      await logAction(session.userId, userId, "update_plan", `Changed plan for ${targetUser.email} to "${plan}"`, ip)
      return NextResponse.json({ success: true })
    }

    case "delete_badge": {
      if (!badgeId) return NextResponse.json({ error: "badgeId required" }, { status: 400 })
      // First get badge info for logging
      const badge = await pool.query("SELECT name, display_name FROM badges WHERE id = $1", [badgeId])
      if (badge.rows.length === 0) return NextResponse.json({ error: "Badge not found" }, { status: 404 })
      // Delete badge (cascades to user_badges)
      await pool.query("DELETE FROM badges WHERE id = $1", [badgeId])
      await logAction(session.userId, userId, "delete_badge", `Deleted badge "${badge.rows[0].display_name}" permanently`, ip)
      return NextResponse.json({ success: true })
    }

    case "reset_2fa": {
      // Remove 2FA from user
      await pool.query("UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, backup_codes = NULL, updated_at = NOW() WHERE id = $1", [userId])
      await logAction(session.userId, userId, "reset_2fa", `Reset two-factor authentication for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "delete_scans": {
      // Delete all scans for user
      const scanCount = await pool.query("SELECT COUNT(*) FROM scan_history WHERE user_id = $1", [userId])
      await pool.query("DELETE FROM scan_history WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "delete_scans", `Deleted ${scanCount.rows[0].count} scans for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }



    case "clear_rate_limits": {
      // Clear rate limits from redis (if using upstash) or just acknowledge
      // For now we just log it - actual implementation depends on rate limiter
      await logAction(session.userId, userId, "clear_rate_limits", `Cleared rate limits for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "export_data": {
      // Collect all user data for export
      const userData = await pool.query("SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1", [userId])
      const scans = await pool.query("SELECT url, findings_count, source, scanned_at FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC", [userId])
      const apiKeys = await pool.query("SELECT name, key_prefix, created_at, revoked_at FROM api_keys WHERE user_id = $1", [userId])
      const badges = await pool.query(`
        SELECT b.name, b.display_name, b.color, ub.awarded_at
        FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = $1
      `, [userId])
      
      const exportData = {
        user: userData.rows[0],
        scans: scans.rows,
        apiKeys: apiKeys.rows,
        badges: badges.rows,
        exportedAt: new Date().toISOString(),
        exportedBy: session.email,
      }
      
      await logAction(session.userId, userId, "export_data", `Exported all data for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true, data: exportData })
    }

    case "toggle_beta_access": {
      const currentBeta = await pool.query("SELECT beta_access FROM users WHERE id = $1", [userId])
      const newBeta = !currentBeta.rows[0]?.beta_access
      await pool.query("UPDATE users SET beta_access = $1, updated_at = NOW() WHERE id = $2", [newBeta, userId])
      await logAction(session.userId, userId, "toggle_beta_access", `${newBeta ? "Granted" : "Revoked"} beta access for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true, beta_access: newBeta })
    }

    case "send_notification": {
      const { title, message: notifMessage, type: notifType } = await request.json()
      if (!title || !notifMessage) return NextResponse.json({ error: "title and message required" }, { status: 400 })
      // This would integrate with a notification system - for now just log
      await logAction(session.userId, userId, "send_notification", `Sent notification "${title}" to ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "verify_email": {
      await pool.query("UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1", [userId])
      await logAction(session.userId, userId, "verify_email", `Manually verified email for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "unverify_email": {
      await pool.query("UPDATE users SET email_verified_at = NULL, updated_at = NOW() WHERE id = $1", [userId])
      await logAction(session.userId, userId, "unverify_email", `Unverified email for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "delete_webhooks": {
      const webhookCount = await pool.query("SELECT COUNT(*) FROM webhooks WHERE user_id = $1", [userId])
      await pool.query("DELETE FROM webhooks WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "delete_webhooks", `Deleted ${webhookCount.rows[0].count} webhooks for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "delete_schedules": {
      const scheduleCount = await pool.query("SELECT COUNT(*) FROM scheduled_scans WHERE user_id = $1", [userId])
      await pool.query("DELETE FROM scheduled_scans WHERE user_id = $1", [userId])
      await logAction(session.userId, userId, "delete_schedules", `Deleted ${scheduleCount.rows[0].count} scheduled scans for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "impersonate": {
      // Create an impersonation session (admin only, heavily logged)
      if (session.role !== STAFF_ROLES.ADMIN) {
        return NextResponse.json({ error: "Only admins can impersonate users" }, { status: 403 })
      }
      await logAction(session.userId, userId, "impersonate", `Started impersonation session for ${targetUser.email}`, ip)
      // Return info for client to handle - actual impersonation would need session management
      return NextResponse.json({ success: true, impersonating: targetUser.email })
    }

    case "force_logout_all": {
      // Delete all sessions and revoke all tokens
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId])
      await pool.query("UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [userId])
      await logAction(session.userId, userId, "force_logout_all", `Force logged out ${targetUser.email} and revoked all API keys`, ip)
      return NextResponse.json({ success: true })
    }

    case "set_scan_limit": {
      const { limit: scanLimit } = await request.json()
      if (typeof scanLimit !== "number" || scanLimit < 0 || scanLimit > 10000) {
        return NextResponse.json({ error: "Invalid scan limit (0-10000)" }, { status: 400 })
      }
      await pool.query("UPDATE users SET daily_scan_limit = $1, updated_at = NOW() WHERE id = $2", [scanLimit, userId])
      await logAction(session.userId, userId, "set_scan_limit", `Set daily scan limit to ${scanLimit} for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "add_note": {
      const { note } = await request.json()
      if (!note || typeof note !== "string") return NextResponse.json({ error: "note required" }, { status: 400 })
      const safeNote = note.trim().slice(0, 1000)
      await pool.query(`
        INSERT INTO admin_user_notes (user_id, admin_id, note, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [userId, session.userId, safeNote])
      await logAction(session.userId, userId, "add_note", `Added admin note to ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "clear_avatar": {
      await pool.query("UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1", [userId])
      await logAction(session.userId, userId, "clear_avatar", `Cleared avatar for ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    case "gift_subscription": {
      if (!giftPlan || !giftEndDate) {
        return NextResponse.json({ error: "giftPlan and giftEndDate required" }, { status: 400 })
      }
      const validPlans = ["core_supporter", "pro_supporter", "elite_supporter"]
      if (!validPlans.includes(giftPlan)) {
        return NextResponse.json({ error: "Invalid plan. Must be one of: " + validPlans.join(", ") }, { status: 400 })
      }
      const expiresAt = new Date(giftEndDate)
      if (isNaN(expiresAt.getTime())) {
        return NextResponse.json({ error: "Invalid giftEndDate" }, { status: 400 })
      }
      // Revoke any existing active gift first, then insert new one
      await pool.query(
        "UPDATE gifted_subscriptions SET revoked_at = NOW(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [userId, session.userId]
      )
      await pool.query(
        "INSERT INTO gifted_subscriptions (user_id, plan, expires_at, gifted_by) VALUES ($1, $2, $3, $4)",
        [userId, giftPlan, expiresAt, session.userId]
      )
      await logAction(session.userId, userId, "gift_subscription", `Gifted ${giftPlan} plan until ${expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, ip)
      return NextResponse.json({ success: true })
    }

    case "revoke_gift": {
      await pool.query(
        "UPDATE gifted_subscriptions SET revoked_at = NOW(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [userId, session.userId]
      )
      await logAction(session.userId, userId, "revoke_gift", `Revoked gifted subscription from ${targetUser.email}`, ip)
      return NextResponse.json({ success: true })
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }
}
