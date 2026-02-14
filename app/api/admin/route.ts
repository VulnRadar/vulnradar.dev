import { NextRequest, NextResponse } from "next/server"
import { randomBytes, scryptSync } from "node:crypto"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { getClientIP } from "@/lib/rate-limit"
import { ERROR_MESSAGES, STAFF_ROLE_HIERARCHY } from "@/lib/constants"

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
  const limit = 5
  const offset = (page - 1) * limit
  const section = searchParams.get("section")
  const search = searchParams.get("search")?.trim() || ""

  // Fetch user detail
  if (section === "user-detail") {
    const userId = searchParams.get("userId")
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

    const [userRes, scansRes, keysRes, webhooksRes, schedulesRes, sessionsRes] = await Promise.all([
      pool.query(
        `SELECT id, email, name, role, avatar_url, totp_enabled, tos_accepted_at, created_at, disabled_at,
          (SELECT COUNT(*) FROM scan_history WHERE user_id = $1)::int as scan_count,
          (SELECT COUNT(*) FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL)::int as api_key_count,
          (SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND expires_at > NOW())::int as session_count,
          (backup_codes IS NOT NULL AND backup_codes != '[]') as has_backup_codes
        FROM users WHERE id = $1`,
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
    ])

    if (!userRes.rows[0]) return NextResponse.json({ error: "User not found" }, { status: 404 })

    return NextResponse.json({
      user: userRes.rows[0],
      recentScans: scansRes.rows,
      apiKeys: keysRes.rows,
      webhooks: webhooksRes.rows,
      schedules: schedulesRes.rows,
      activeSessions: sessionsRes.rows,
    })
  }

  // Fetch audit log
  if (section === "audit") {
    const auditRes = await pool.query(
      `SELECT al.id, al.action, al.details, al.created_at, al.ip_address,
        al.admin_id, al.target_user_id,
        au.email as admin_email, au.name as admin_name, au.avatar_url as admin_avatar_url,
        tu.email as target_email, tu.name as target_name, tu.avatar_url as target_avatar_url
      FROM admin_audit_log al
      LEFT JOIN users au ON al.admin_id = au.id
      LEFT JOIN users tu ON al.target_user_id = tu.id
      ORDER BY al.created_at DESC
      LIMIT 50 OFFSET $1`,
      [offset],
    )
    const totalRes = await pool.query("SELECT COUNT(*)::int as count FROM admin_audit_log")
    return NextResponse.json({
      logs: auditRes.rows,
      total: totalRes.rows[0].count,
      page,
      totalPages: Math.ceil(totalRes.rows[0].count / 50),
    })
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
        (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id AND al.created_at > NOW() - INTERVAL '24 hours')::int as actions_24h
      FROM users u
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
        (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) as disabled_users
    `),
    search
      ? pool.query(`
          SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at,
            (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
            (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count
          FROM users u
          WHERE u.email ILIKE $3 OR u.name ILIKE $3
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `, [limit, offset, `%${search}%`])
      : pool.query(`
          SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at,
            (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
            (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count
          FROM users u
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
// Moderator: disable/enable, revoke_sessions, revoke_api_keys
// Support: view only (no PATCH actions)
function canPerformAction(role: string, action: string): boolean {
  const adminOnly = ["make_admin", "remove_admin", "set_role", "delete", "reset_password"]
  const modActions = ["disable", "enable", "revoke_sessions", "revoke_api_keys"]
  if (role === "admin") return true
  if (role === "moderator") return modActions.includes(action)
  return false // support = view only
}

// PATCH: Admin actions on users
export async function PATCH(request: NextRequest) {
  const session = await requireStaff()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 })

  const ip = await getClientIP()
  const { action, userId, role: newRole } = await request.json()

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
  if (session.role === "moderator" && (STAFF_ROLE_HIERARCHY[targetUser.role] || 0) >= (STAFF_ROLE_HIERARCHY.moderator || 2)) {
    return NextResponse.json({ error: "You cannot perform actions on users with equal or higher roles." }, { status: 403 })
  }

  switch (action) {
    case "set_role": {
      const validRoles = ["user", "support", "moderator", "admin"]
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

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }
}
