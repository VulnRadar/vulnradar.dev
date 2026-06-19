import { NextRequest, NextResponse } from "next/server";
import { randomBytes, scryptSync } from "node:crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import {
  ERROR_MESSAGES,
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
} from "@/lib/config/constants";
import {
  sendEmail,
  adminNotificationEmail,
  adminAccountChangeEmail,
} from "@/lib/email/email";

// Helper to send email only if user notification is enabled
async function sendNotificationIfEnabled(
  shouldSend: boolean | undefined,
  to: string,
  emailPayload: { subject: string; text: string; html: string },
) {
  if (shouldSend !== false) {
    // default to true if not specified
    sendEmail({ to, ...emailPayload }).catch(console.error);
  }
}

// Helper to get admin name for emails
async function getAdminName(adminId: number): Promise<string> {
  const result = await pool.query(
    "SELECT name, email FROM users WHERE id = $1",
    [adminId],
  );
  return result.rows[0]?.name || result.rows[0]?.email || "Administrator";
}

// Helper to get user name for emails
async function getUserName(userId: number): Promise<string> {
  const result = await pool.query(
    "SELECT name, email FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0]?.name || result.rows[0]?.email || "User";
}

async function requireStaff() {
  const session = await getSession();
  if (!session) return null;
  const result = await pool.query("SELECT role FROM users WHERE id = $1", [
    session.userId,
  ]);
  const user = result.rows[0];
  if (!user) return null;
  const role = user.role || "user";
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1))
    return null;
  return { ...session, role };
}

async function logAction(
  adminId: number,
  targetUserId: number | null,
  action: string,
  details?: string,
  ip?: string,
) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, targetUserId, action, details || null, ip || null],
  );
}

// GET: Admin dashboard stats + user list + audit log
export async function GET(request: NextRequest) {
  const session = await requireStaff();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );

  const { searchParams } = new URL(request.url);
  const pageParam = searchParams.get("page");
  const limitParam = searchParams.get("limit");

  const page = Math.max(1, Number(pageParam || 1));
  let limit = 10;
  if (limitParam && limitParam !== "undefined") {
    const parsedLimit = Number(limitParam);
    if (!isNaN(parsedLimit)) {
      limit = Math.min(100, Math.max(1, parsedLimit));
    }
  }

  if (isNaN(page) || isNaN(limit)) {
    return NextResponse.json(
      { error: "Invalid pagination parameters" },
      { status: 400 },
    );
  }

  const offset = (page - 1) * limit;
  const section = searchParams.get("section");
  const search = searchParams.get("search")?.trim() || "";

  // Fetch user detail
  if (section === "user-detail") {
    const userId = searchParams.get("userId");
    if (!userId)
      return NextResponse.json({ error: "userId required" }, { status: 400 });

    const [
      userRes,
      scansRes,
      keysRes,
      webhooksRes,
      schedulesRes,
      sessionsRes,
      badgesRes,
      notesRes,
    ] = await Promise.all([
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
      pool.query(
        "SELECT id, name, url, type, active FROM webhooks WHERE user_id = $1",
        [userId],
      ),
      pool.query(
        "SELECT id, url, frequency, active, last_run_at, next_run_at FROM scheduled_scans WHERE user_id = $1",
        [userId],
      ),
      pool.query(
        "SELECT id, created_at, expires_at, ip_address, user_agent FROM sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC",
        [userId],
      ),
      pool.query(
        `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, b.is_limited, ub.awarded_at
         FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
         WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
        [userId],
      ),
      pool.query(
        `SELECT n.id, n.note, n.created_at, a.id as admin_id, a.email as admin_email, a.name as admin_name, a.avatar_url as admin_avatar_url
         FROM admin_user_notes n
         JOIN users a ON n.admin_id = a.id
         WHERE n.user_id = $1
         ORDER BY n.created_at DESC`,
        [userId],
      ),
    ]);

    if (!userRes.rows[0])
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    return NextResponse.json({
      user: userRes.rows[0],
      recentScans: scansRes.rows,
      apiKeys: keysRes.rows,
      webhooks: webhooksRes.rows,
      schedules: schedulesRes.rows,
      activeSessions: sessionsRes.rows,
      badges: badgesRes.rows,
      notes: notesRes.rows,
    });
  }

  // Fetch audit log
  if (section === "audit") {
    const auditLimit = limit;
    const auditOffset = (page - 1) * auditLimit;
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
    );
    const totalRes = await pool.query(
      "SELECT COUNT(*)::int as count FROM admin_audit_log",
    );
    return NextResponse.json({
      logs: auditRes.rows,
      total: totalRes.rows[0].count,
      page,
      totalPages: Math.ceil(totalRes.rows[0].count / auditLimit),
    });
  }

  // All badges list
  if (section === "badges") {
    const badgesRes = await pool.query(
      "SELECT * FROM badges ORDER BY priority DESC, name ASC",
    );
    return NextResponse.json({ badges: badgesRes.rows });
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
    `);
    return NextResponse.json({ admins: adminsRes.rows });
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
      ? pool.query(
          `
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
        `,
          [limit, offset, `%${search}%`],
        )
      : pool.query(
          `
          SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at, u.plan, u.subscription_status,
            (SELECT COUNT(*) FROM scan_history sh WHERE sh.user_id = u.id) as scan_count,
            (SELECT COUNT(*) FROM api_keys ak WHERE ak.user_id = u.id AND ak.revoked_at IS NULL) as api_key_count,
            gs.plan as gifted_plan,
            gs.expires_at as gift_end_date
          FROM users u
          LEFT JOIN gifted_subscriptions gs ON gs.user_id = u.id AND gs.revoked_at IS NULL AND gs.expires_at > NOW()
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `,
          [limit, offset],
        ),
    search
      ? pool.query(
          "SELECT COUNT(*) FROM users WHERE email ILIKE $1 OR name ILIKE $1",
          [`%${search}%`],
        )
      : pool.query("SELECT COUNT(*) FROM users"),
  ]);

  return NextResponse.json({
    stats: statsResult.rows[0],
    users: usersResult.rows,
    total: Number(totalResult.rows[0].count),
    page,
    totalPages: Math.ceil(Number(totalResult.rows[0].count) / limit),
    callerRole: session.role,
  });
}

// Permission helpers per role
// Admin: all actions
// Moderator: disable/enable, revoke_sessions, revoke_api_keys, delete_scans, clear_rate_limits, verify_email, add_note, clear_avatar
// Support: view only (no PATCH actions)
function canPerformAction(role: string, action: string): boolean {
  const _adminOnly = [
    "make_admin",
    "remove_admin",
    "set_role",
    "delete",
    "reset_password",
    "award_badge",
    "revoke_badge",
    "create_badge",
    "delete_badge",
    "update_email",
    "update_plan",
    "toggle_beta_access",
    "impersonate",
    "set_scan_limit",
    "export_data",
  ];
  const modActions = [
    "award_badge",
    "revoke_badge",
    "create_badge",
    "delete_badge",
    "update_name",
    "update_email",
    "verify_email",
    "revoke_sessions",
    "revoke_api_keys",
    "toggle_beta_access",
    "delete_scans",
    "delete_webhooks",
    "delete_schedules",
    "clear_rate_limits",
    "verify_email",
    "unverify_email",
    "force_logout_all",
    "add_note",
    "clear_avatar",
    "update_name",
    "reset_2fa",
    "send_notification",
    "gift_subscription",
    "revoke_gift",
  ];
  if (role === STAFF_ROLES.ADMIN) return true;
  if (role === STAFF_ROLES.MODERATOR) return modActions.includes(action);
  return false; // support = view only
}

// PATCH: Admin actions on users
export async function PATCH(request: NextRequest) {
  const session = await requireStaff();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );

  const ip = await getClientIp();
  const {
    action,
    userId,
    role: newRole,
    badgeId: rawBadgeId,
    name: badgeName,
    displayName,
    color: badgeColor,
    name,
    email,
    plan,
    giftPlan,
    giftEndDate,
    note,
    noteId,
    notifyUser,
  } = await request.json();
  // Normalize badgeId to number (client may send as string)
  const badgeId = rawBadgeId != null ? Number(rawBadgeId) : undefined;

  if (!userId || !action) {
    return NextResponse.json(
      { error: "Missing action or userId" },
      { status: 400 },
    );
  }

  // Check role-based permissions
  if (!canPerformAction(session.role, action)) {
    return NextResponse.json(
      { error: "You don't have permission to perform this action." },
      { status: 403 },
    );
  }

  // Protect the owner account (user ID 1) from any modifications
  if (userId === 1 && session.userId !== 1) {
    return NextResponse.json(
      { error: "This account is protected and cannot be modified." },
      { status: 403 },
    );
  }

  // Prevent self-modification for dangerous actions
  if (
    userId === session.userId &&
    [
      "remove_admin",
      "delete",
      "disable",
      "reset_password",
      "set_role",
    ].includes(action)
  ) {
    return NextResponse.json(
      { error: "Cannot perform this action on your own account." },
      { status: 400 },
    );
  }

  // Get target user for logging
  const targetRes = await pool.query(
    "SELECT email, totp_enabled, role FROM users WHERE id = $1",
    [userId],
  );
  if (!targetRes.rows[0])
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  const targetUser = targetRes.rows[0];

  // Moderators cannot act on admins or other moderators
  if (
    session.role === STAFF_ROLES.MODERATOR &&
    (STAFF_ROLE_HIERARCHY[targetUser.role] || 0) >=
      (STAFF_ROLE_HIERARCHY[STAFF_ROLES.MODERATOR] || 2)
  ) {
    return NextResponse.json(
      {
        error:
          "You cannot perform actions on users with equal or higher roles.",
      },
      { status: 403 },
    );
  }

  switch (action) {
    case "set_role": {
      const validRoles = Object.values(STAFF_ROLES);
      if (!newRole || !validRoles.includes(newRole)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      const oldRole = targetUser.role || "user";
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [
        newRole,
        userId,
      ]);
      await logAction(
        session.userId,
        userId,
        "set_role",
        `Changed role of ${targetUser.email} from ${oldRole} to ${newRole}`,
        ip,
      );

      // Send email notification
      const [adminName, userName] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const roleLabels: Record<string, string> = {
        user: "User",
        support: "Support",
        moderator: "Moderator",
        admin: "Admin",
      };
      const emailPayload = adminAccountChangeEmail({
        userName,
        adminName,
        changes: [
          {
            field: "Account Role",
            oldValue: roleLabels[oldRole] || oldRole,
            newValue: roleLabels[newRole] || newRole,
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayload,
      );

      return NextResponse.json({ success: true });
    }

    case "make_admin":
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
        userId,
      ]);
      await logAction(
        session.userId,
        userId,
        "make_admin",
        `Granted admin to ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });

    case "remove_admin":
      await pool.query("UPDATE users SET role = 'user' WHERE id = $1", [
        userId,
      ]);
      await logAction(
        session.userId,
        userId,
        "remove_admin",
        `Removed admin from ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });

    case "reset_password": {
      if (targetUser.totp_enabled) {
        return NextResponse.json(
          {
            error:
              "Cannot reset password for users with 2FA enabled. The user must disable 2FA first, or use their backup codes to regain access.",
          },
          { status: 400 },
        );
      }
      const tempPassword = randomBytes(6).toString("base64url").slice(0, 12);
      const salt = randomBytes(16).toString("hex");
      const hash = scryptSync(tempPassword, salt, 64).toString("hex");
      const passwordHash = `${salt}:${hash}`;
      await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        passwordHash,
        userId,
      ]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "reset_password",
        `Reset password for ${targetUser.email}`,
        ip,
      );

      // Send email notification with temp password
      const [adminNamePwd, userNamePwd] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadPwd = adminAccountChangeEmail({
        userName: userNamePwd,
        adminName: adminNamePwd,
        changes: [
          {
            field: "Password",
            oldValue: "Previous password",
            newValue: "Reset (temporary password sent)",
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadPwd,
      );

      return NextResponse.json({ success: true, tempPassword });
    }

    case "revoke_sessions": {
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "revoke_sessions",
        `Revoked all sessions for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminNameSess, userNameSess] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadSess = adminAccountChangeEmail({
        userName: userNameSess,
        adminName: adminNameSess,
        changes: [
          {
            field: "Active Sessions",
            oldValue: "All sessions",
            newValue: "Revoked",
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadSess,
      );

      return NextResponse.json({ success: true });
    }

    case "revoke_api_keys": {
      await pool.query(
        "UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "revoke_api_keys",
        `Revoked all API keys for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminNameKeys, userNameKeys] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadKeys = adminAccountChangeEmail({
        userName: userNameKeys,
        adminName: adminNameKeys,
        changes: [
          { field: "API Keys", oldValue: "All keys", newValue: "Revoked" },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadKeys,
      );

      return NextResponse.json({ success: true });
    }

    case "disable": {
      await pool.query("UPDATE users SET disabled_at = NOW() WHERE id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "disable_user",
        `Disabled account for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminNameDis, userNameDis] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadDis = adminAccountChangeEmail({
        userName: userNameDis,
        adminName: adminNameDis,
        changes: [
          { field: "Account Status", oldValue: "Active", newValue: "Disabled" },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadDis,
      );

      return NextResponse.json({ success: true });
    }

    case "enable":
    case "enable_user": {
      await pool.query("UPDATE users SET disabled_at = NULL WHERE id = $1", [
        userId,
      ]);
      await logAction(
        session.userId,
        userId,
        "enable_user",
        `Re-enabled account for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminNameEn, userNameEn] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadEn = adminAccountChangeEmail({
        userName: userNameEn,
        adminName: adminNameEn,
        changes: [
          { field: "Account Status", oldValue: "Disabled", newValue: "Active" },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadEn,
      );

      return NextResponse.json({ success: true });
    }

    case "award_badge": {
      if (!badgeId)
        return NextResponse.json(
          { error: "badgeId required" },
          { status: 400 },
        );
      const badgeInfo = await pool.query(
        "SELECT name, display_name FROM badges WHERE id = $1",
        [badgeId],
      );
      if (badgeInfo.rows.length === 0)
        return NextResponse.json({ error: "Badge not found" }, { status: 404 });
      // Check if already awarded
      const existing = await pool.query(
        "SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = $2",
        [userId, badgeId],
      );
      if (existing.rows.length > 0)
        return NextResponse.json(
          { error: "Badge already awarded to this user" },
          { status: 409 },
        );
      await pool.query(
        "INSERT INTO user_badges (user_id, badge_id, awarded_by, awarded_at) VALUES ($1, $2, $3, NOW())",
        [userId, badgeId, session.userId],
      );
      await logAction(
        session.userId,
        userId,
        "award_badge",
        `Awarded badge "${badgeInfo.rows[0].display_name}" to ${targetUser.email}`,
        ip,
      );

      // Send email notification
      if (notifyUser) {
        const [adminName, userName] = await Promise.all([
          getAdminName(session.userId),
          getUserName(userId),
        ]);
        const emailPayload = adminAccountChangeEmail({
          userName,
          adminName,
          changes: [
            {
              field: "Badge Awarded",
              oldValue: "—",
              newValue: badgeInfo.rows[0].display_name,
            },
          ],
          timestamp: new Date(),
        });
        await sendNotificationIfEnabled(true, targetUser.email, emailPayload);
      }
      return NextResponse.json({ success: true });
    }

    case "revoke_badge": {
      if (!badgeId)
        return NextResponse.json(
          { error: "badgeId required" },
          { status: 400 },
        );
      const badgeInfoRevoke = await pool.query(
        "SELECT name, display_name FROM badges WHERE id = $1",
        [badgeId],
      );
      if (badgeInfoRevoke.rows.length === 0)
        return NextResponse.json({ error: "Badge not found" }, { status: 404 });
      await pool.query(
        "DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2",
        [userId, badgeId],
      );
      await logAction(
        session.userId,
        userId,
        "revoke_badge",
        `Revoked badge "${badgeInfoRevoke.rows[0].display_name}" from ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "create_badge": {
      if (!badgeName || !displayName)
        return NextResponse.json(
          { error: "name and displayName required" },
          { status: 400 },
        );
      // Check uniqueness
      const dupCheck = await pool.query(
        "SELECT 1 FROM badges WHERE name = $1",
        [badgeName],
      );
      if (dupCheck.rows.length > 0)
        return NextResponse.json(
          { error: "Badge name already exists" },
          { status: 409 },
        );
      const newBadge = await pool.query(
        "INSERT INTO badges (name, display_name, description, color, is_limited, created_at) VALUES ($1, $2, $3, $4, false, NOW()) RETURNING id",
        [badgeName, displayName, "", badgeColor || "#6366f1"],
      );
      await logAction(
        session.userId,
        userId,
        "create_badge",
        `Created new badge "${displayName}" (${badgeName})`,
        ip,
      );
      return NextResponse.json({ success: true, badgeId: newBadge.rows[0].id });
    }

    case "delete_badge": {
      if (!badgeId)
        return NextResponse.json(
          { error: "badgeId required" },
          { status: 400 },
        );
      // First get badge info for logging
      const badge = await pool.query(
        "SELECT name, display_name FROM badges WHERE id = $1",
        [badgeId],
      );
      if (badge.rows.length === 0)
        return NextResponse.json({ error: "Badge not found" }, { status: 404 });
      // Delete badge (cascades to user_badges)
      await pool.query("DELETE FROM badges WHERE id = $1", [badgeId]);
      await logAction(
        session.userId,
        userId,
        "delete_badge",
        `Deleted badge "${badge.rows[0].display_name}" permanently`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "reset_2fa": {
      // Remove 2FA from user
      await pool.query(
        "UPDATE users SET totp_secret = NULL, totp_enabled = FALSE, backup_codes = NULL, updated_at = NOW() WHERE id = $1",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "reset_2fa",
        `Reset two-factor authentication for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminName, userName] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayload = adminAccountChangeEmail({
        userName,
        adminName,
        changes: [
          {
            field: "Two-Factor Authentication",
            oldValue: "Enabled",
            newValue: "Disabled (Reset)",
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayload,
      );

      return NextResponse.json({ success: true });
    }

    case "delete_scans": {
      // Delete all scans for user
      const scanCount = await pool.query(
        "SELECT COUNT(*) FROM scan_history WHERE user_id = $1",
        [userId],
      );
      await pool.query("DELETE FROM scan_history WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "delete_scans",
        `Deleted ${scanCount.rows[0].count} scans for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "clear_rate_limits": {
      // Clear rate limits from redis (if using upstash) or just acknowledge
      // For now we just log it - actual implementation depends on rate limiter
      await logAction(
        session.userId,
        userId,
        "clear_rate_limits",
        `Cleared rate limits for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "export_data": {
      // Collect all user data for export
      const userData = await pool.query(
        "SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1",
        [userId],
      );
      const scans = await pool.query(
        "SELECT url, findings_count, source, scanned_at FROM scan_history WHERE user_id = $1 ORDER BY scanned_at DESC",
        [userId],
      );
      const apiKeys = await pool.query(
        "SELECT name, key_prefix, created_at, revoked_at FROM api_keys WHERE user_id = $1",
        [userId],
      );
      const badges = await pool.query(
        `
        SELECT b.name, b.display_name, b.color, ub.awarded_at
        FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = $1
      `,
        [userId],
      );

      const exportData = {
        user: userData.rows[0],
        scans: scans.rows,
        apiKeys: apiKeys.rows,
        badges: badges.rows,
        exportedAt: new Date().toISOString(),
        exportedBy: session.email,
      };

      await logAction(
        session.userId,
        userId,
        "export_data",
        `Exported all data for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true, data: exportData });
    }

    case "toggle_beta_access": {
      const currentBeta = await pool.query(
        "SELECT beta_access FROM users WHERE id = $1",
        [userId],
      );
      const newBeta = !currentBeta.rows[0]?.beta_access;
      await pool.query(
        "UPDATE users SET beta_access = $1, updated_at = NOW() WHERE id = $2",
        [newBeta, userId],
      );
      await logAction(
        session.userId,
        userId,
        "toggle_beta_access",
        `${newBeta ? "Granted" : "Revoked"} beta access for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true, beta_access: newBeta });
    }

    case "send_notification": {
      const {
        title,
        message: notifMessage,
        type: notifType,
      } = await request.json();
      if (!title || !notifMessage)
        return NextResponse.json(
          { error: "title and message required" },
          { status: 400 },
        );

      // Get admin name for the email
      const adminResult = await pool.query(
        "SELECT name, email FROM users WHERE id = $1",
        [session.userId],
      );
      const adminName =
        adminResult.rows[0]?.name ||
        adminResult.rows[0]?.email ||
        "Administrator";

      // Send the notification email only if user notification is enabled
      if (notifyUser !== false) {
        const emailPayload = adminNotificationEmail({
          userName: targetUser.name || targetUser.email,
          adminName,
          title,
          message: notifMessage,
          type: notifType || "info",
          timestamp: new Date(),
        });

        await sendNotificationIfEnabled(
          notifyUser,
          targetUser.email,
          emailPayload,
        );
      }

      await logAction(
        session.userId,
        userId,
        "send_notification",
        `Sent notification "${title}" to ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "verify_email": {
      await pool.query(
        "UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "verify_email",
        `Manually verified email for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "unverify_email": {
      await pool.query(
        "UPDATE users SET email_verified_at = NULL, updated_at = NOW() WHERE id = $1",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "unverify_email",
        `Unverified email for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "delete_webhooks": {
      const webhookCount = await pool.query(
        "SELECT COUNT(*) FROM webhooks WHERE user_id = $1",
        [userId],
      );
      await pool.query("DELETE FROM webhooks WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "delete_webhooks",
        `Deleted ${webhookCount.rows[0].count} webhooks for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "delete_schedules": {
      const scheduleCount = await pool.query(
        "SELECT COUNT(*) FROM scheduled_scans WHERE user_id = $1",
        [userId],
      );
      await pool.query("DELETE FROM scheduled_scans WHERE user_id = $1", [
        userId,
      ]);
      await logAction(
        session.userId,
        userId,
        "delete_schedules",
        `Deleted ${scheduleCount.rows[0].count} scheduled scans for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "impersonate": {
      // Create an impersonation session (admin only, heavily logged)
      if (session.role !== STAFF_ROLES.ADMIN) {
        return NextResponse.json(
          { error: "Only admins can impersonate users" },
          { status: 403 },
        );
      }
      await logAction(
        session.userId,
        userId,
        "impersonate",
        `Started impersonation session for ${targetUser.email}`,
        ip,
      );
      // Return info for client to handle - actual impersonation would need session management
      return NextResponse.json({
        success: true,
        impersonating: targetUser.email,
      });
    }

    case "force_logout_all": {
      // Delete all sessions and revoke all tokens
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await pool.query(
        "UPDATE api_keys SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "force_logout_all",
        `Force logged out ${targetUser.email} and revoked all API keys`,
        ip,
      );

      // Send email notification
      const [adminNameLogout, userNameLogout] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadLogout = adminAccountChangeEmail({
        userName: userNameLogout,
        adminName: adminNameLogout,
        changes: [
          {
            field: "Active Sessions",
            oldValue: "All sessions",
            newValue: "Revoked",
          },
          { field: "API Keys", oldValue: "All keys", newValue: "Revoked" },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadLogout,
      );

      return NextResponse.json({ success: true });
    }

    case "set_scan_limit": {
      const { limit: scanLimit } = await request.json();
      if (typeof scanLimit !== "number" || scanLimit < 0 || scanLimit > 10000) {
        return NextResponse.json(
          { error: "Invalid scan limit (0-10000)" },
          { status: 400 },
        );
      }
      await pool.query(
        "UPDATE users SET daily_scan_limit = $1, updated_at = NOW() WHERE id = $2",
        [scanLimit, userId],
      );
      await logAction(
        session.userId,
        userId,
        "set_scan_limit",
        `Set daily scan limit to ${scanLimit} for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "add_note": {
      if (!note || typeof note !== "string")
        return NextResponse.json({ error: "note required" }, { status: 400 });
      const safeNote = note.trim().slice(0, 1000);
      await pool.query(
        `
        INSERT INTO admin_user_notes (user_id, admin_id, note, created_at)
        VALUES ($1, $2, $3, NOW())
      `,
        [userId, session.userId, safeNote],
      );
      await logAction(
        session.userId,
        userId,
        "add_note",
        `Added admin note to ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "edit_note": {
      if (!noteId || !note || typeof note !== "string")
        return NextResponse.json(
          { error: "noteId and note required" },
          { status: 400 },
        );
      const safeNote = note.trim().slice(0, 1000);
      const ownerCheck = await pool.query(
        "SELECT admin_id FROM admin_user_notes WHERE id = $1",
        [noteId],
      );
      if (!ownerCheck.rows[0])
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      const isOwner = ownerCheck.rows[0].admin_id === session.userId;
      if (!isOwner && callerRole !== "admin")
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await pool.query("UPDATE admin_user_notes SET note = $1 WHERE id = $2", [
        safeNote,
        noteId,
      ]);
      await logAction(
        session.userId,
        userId,
        "edit_note",
        `Edited admin note on ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "delete_note": {
      if (!noteId)
        return NextResponse.json({ error: "noteId required" }, { status: 400 });
      const ownerCheck = await pool.query(
        "SELECT admin_id FROM admin_user_notes WHERE id = $1",
        [noteId],
      );
      if (!ownerCheck.rows[0])
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      const isOwner = ownerCheck.rows[0].admin_id === session.userId;
      if (!isOwner && callerRole !== "admin")
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      await pool.query("DELETE FROM admin_user_notes WHERE id = $1", [noteId]);
      await logAction(
        session.userId,
        userId,
        "delete_note",
        `Deleted admin note on ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "clear_avatar": {
      await pool.query(
        "UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "clear_avatar",
        `Cleared avatar for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "gift_subscription": {
      if (!giftPlan || !giftEndDate) {
        return NextResponse.json(
          { error: "giftPlan and giftEndDate required" },
          { status: 400 },
        );
      }
      const validPlans = ["core_supporter", "pro_supporter", "elite_supporter"];
      if (!validPlans.includes(giftPlan)) {
        return NextResponse.json(
          { error: "Invalid plan. Must be one of: " + validPlans.join(", ") },
          { status: 400 },
        );
      }
      const expiresAt = new Date(giftEndDate);
      if (isNaN(expiresAt.getTime())) {
        return NextResponse.json(
          { error: "Invalid giftEndDate" },
          { status: 400 },
        );
      }
      // Revoke any existing active gift first, then insert new one
      await pool.query(
        "UPDATE gifted_subscriptions SET revoked_at = NOW(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [userId, session.userId],
      );
      await pool.query(
        "INSERT INTO gifted_subscriptions (user_id, plan, expires_at, gifted_by) VALUES ($1, $2, $3, $4)",
        [userId, giftPlan, expiresAt, session.userId],
      );

      // Award premium badge if they don't already have it
      const premiumBadgeGift = await pool.query(
        "SELECT id FROM badges WHERE name = 'premium' LIMIT 1",
      );
      if (premiumBadgeGift.rows.length > 0) {
        const badgeIdGift = premiumBadgeGift.rows[0].id;
        const existingBadgeGift = await pool.query(
          "SELECT 1 FROM user_badges WHERE user_id = $1 AND badge_id = $2",
          [userId, badgeIdGift],
        );
        if (existingBadgeGift.rows.length === 0) {
          await pool.query(
            "INSERT INTO user_badges (user_id, badge_id, awarded_by, awarded_at) VALUES ($1, $2, $3, NOW())",
            [userId, badgeIdGift, session.userId],
          );
        }
      }

      await logAction(
        session.userId,
        userId,
        "gift_subscription",
        `Gifted ${giftPlan} plan until ${expiresAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "revoke_gift": {
      await pool.query(
        "UPDATE gifted_subscriptions SET revoked_at = NOW(), revoked_by = $2 WHERE user_id = $1 AND revoked_at IS NULL",
        [userId, session.userId],
      );

      // Revoke premium badge if user is on free plan (no paid subscription)
      if (targetUser.plan === "free" || !targetUser.plan) {
        const premiumBadgeRevoke = await pool.query(
          "SELECT id FROM badges WHERE name = 'premium' LIMIT 1",
        );
        if (premiumBadgeRevoke.rows.length > 0) {
          await pool.query(
            "DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2",
            [userId, premiumBadgeRevoke.rows[0].id],
          );
        }
      }

      await logAction(
        session.userId,
        userId,
        "revoke_gift",
        `Revoked gifted subscription from ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "update_name": {
      if (name === undefined)
        return NextResponse.json({ error: "name required" }, { status: 400 });
      const safeName = (name || "").trim().slice(0, 100);
      const oldName = targetUser.name || "";
      await pool.query(
        "UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2",
        [safeName || null, userId],
      );
      await logAction(
        session.userId,
        userId,
        "update_name",
        `Changed display name from "${oldName}" to "${safeName}" for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const [adminNameN, userNameN] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadN = adminAccountChangeEmail({
        userName: userNameN,
        adminName: adminNameN,
        changes: [
          {
            field: "Display Name",
            oldValue: oldName || "(not set)",
            newValue: safeName || "(cleared)",
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadN,
      );

      return NextResponse.json({ success: true });
    }

    case "update_email": {
      if (!email || typeof email !== "string" || !email.trim()) {
        return NextResponse.json(
          { error: "Email address is required" },
          { status: 400 },
        );
      }
      const newEmail = email.trim().toLowerCase();
      const oldEmail = targetUser.email;

      // Validate email format - simple check without ReDoS vulnerability
      const emailParts = newEmail.split("@");
      if (
        emailParts.length !== 2 ||
        !emailParts[0] ||
        !emailParts[1] ||
        !emailParts[1].includes(".")
      ) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 },
        );
      }

      // Check if email is already taken
      if (newEmail !== oldEmail) {
        const existing = await pool.query(
          "SELECT 1 FROM users WHERE LOWER(email) = $1 AND id != $2",
          [newEmail, userId],
        );
        if (existing.rows.length > 0) {
          return NextResponse.json(
            { error: "Email address is already in use" },
            { status: 409 },
          );
        }
      }

      await pool.query(
        "UPDATE users SET email = $1, email_verified_at = NULL, updated_at = NOW() WHERE id = $2",
        [newEmail, userId],
      );
      await logAction(
        session.userId,
        userId,
        "update_email",
        `Changed email from "${oldEmail}" to "${newEmail}"`,
        ip,
      );

      // Send email notification to BOTH old and new email addresses
      const adminNameE = await getAdminName(session.userId);
      const userNameE = targetUser.name || oldEmail;

      // Notification to OLD email (security alert)
      const emailPayloadOld = adminAccountChangeEmail({
        userName: userNameE,
        adminName: adminNameE,
        changes: [
          { field: "Email Address", oldValue: oldEmail, newValue: newEmail },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(notifyUser, oldEmail, emailPayloadOld);

      // Notification to NEW email (welcome/verification)
      const emailPayloadNew = adminAccountChangeEmail({
        userName: userNameE,
        adminName: adminNameE,
        changes: [
          {
            field: "Email Address",
            oldValue: oldEmail,
            newValue: `${newEmail} (Please verify this email)`,
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(notifyUser, newEmail, emailPayloadNew);

      return NextResponse.json({ success: true });
    }

    case "update_plan": {
      if (!plan || typeof plan !== "string") {
        return NextResponse.json({ error: "plan required" }, { status: 400 });
      }
      const validPlans = [
        "free",
        "core_supporter",
        "pro_supporter",
        "elite_supporter",
      ];
      if (!validPlans.includes(plan)) {
        return NextResponse.json(
          { error: "Invalid plan. Must be one of: " + validPlans.join(", ") },
          { status: 400 },
        );
      }
      const oldPlan = targetUser.plan || "free";
      await pool.query(
        "UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2",
        [plan, userId],
      );
      await logAction(
        session.userId,
        userId,
        "update_plan",
        `Changed subscription plan from "${oldPlan}" to "${plan}" for ${targetUser.email}`,
        ip,
      );

      // Send email notification
      const formatPlan = (p: string) =>
        p === "free"
          ? "Free"
          : p
              .replace("_supporter", " Supporter")
              .replace(/(^\w|\s\w)/g, (m: string) => m.toUpperCase());
      const [adminNameP, userNameP] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadP = adminAccountChangeEmail({
        userName: userNameP,
        adminName: adminNameP,
        changes: [
          {
            field: "Subscription Plan",
            oldValue: formatPlan(oldPlan),
            newValue: formatPlan(plan),
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadP,
      );

      return NextResponse.json({ success: true });
    }

    case "delete":
    case "delete_user":
    case "delete_account": {
      // This permanently deletes a user account - use with caution!
      const userEmail = targetUser.email;
      const userName = targetUser.name || userEmail;

      // Delete respecting FK relationships

      // Sessions & auth
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
        userId,
      ]);
      await pool.query(
        "DELETE FROM email_verification_tokens WHERE user_id = $1",
        [userId],
      );
      await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM device_trust WHERE user_id = $1", [userId]);

      // API
      await pool.query(
        "DELETE FROM api_usage WHERE api_key_id IN (SELECT id FROM api_keys WHERE user_id = $1)",
        [userId],
      );
      await pool.query("DELETE FROM api_keys WHERE user_id = $1", [userId]);

      // Scans
      await pool.query("DELETE FROM scan_tags WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM scheduled_scans WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM scan_history WHERE user_id = $1", [userId]);

      // Integrations
      await pool.query("DELETE FROM webhooks WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM discord_connections WHERE user_id = $1", [
        userId,
      ]);

      // Billing
      await pool.query("DELETE FROM billing_history WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM gifted_subscriptions WHERE user_id = $1", [
        userId,
      ]);

      // Teams
      await pool.query("DELETE FROM team_members WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM team_invites WHERE invited_by = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM teams WHERE owner_id = $1", [userId]);

      // Notifications / prefs
      await pool.query(
        "DELETE FROM notification_preferences WHERE user_id = $1",
        [userId],
      );

      // Security / monitoring
      await pool.query("DELETE FROM security_alerts WHERE user_id = $1", [
        userId,
      ]);
      await pool.query("DELETE FROM staff_activity WHERE user_id = $1", [
        userId,
      ]);

      // GDPR
      await pool.query("DELETE FROM data_requests WHERE user_id = $1", [
        userId,
      ]);

      // Badges
      await pool.query("DELETE FROM user_badges WHERE user_id = $1", [userId]);

      // Admin metadata
      await pool.query("DELETE FROM admin_user_notes WHERE user_id = $1", [
        userId,
      ]);
      await pool.query(
        "DELETE FROM admin_audit_log WHERE target_user_id = $1",
        [userId],
      );

      // Broadcast tracking
      await pool.query("DELETE FROM broadcast_recipients WHERE user_id = $1", [
        userId,
      ]);

      // Finally delete user
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);

      await logAction(
        session.userId,
        userId,
        "delete_account",
        `Permanently deleted account for ${userEmail}`,
        ip,
      );

      // Send final notification to user's email
      const adminNameDel = await getAdminName(session.userId);
      const emailPayloadDel = adminAccountChangeEmail({
        userName: userName,
        adminName: adminNameDel,
        changes: [
          {
            field: "Account",
            oldValue: "Active",
            newValue: "Permanently Deleted",
          },
        ],
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(notifyUser, userEmail, emailPayloadDel);

      return NextResponse.json({ success: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
