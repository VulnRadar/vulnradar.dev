import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
// R3/D1: requireStaff and logAction moved to lib/auth/authorization.ts
// (single source of truth). Local wrappers kept as aliases so the 40+
// existing call sites below don't need to change.
import {
  requireStaff as _requireStaff,
  logAction,
  isSuperAdminRole,
} from "@/lib/auth/authorization";
import { hashPassword, verifyPassword } from "@/lib/auth/auth";
import { startImpersonation } from "@/lib/auth/impersonation";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import {
  syncPlanForRoleChange,
  syncPreStaffPlanForManualPlanChange,
} from "@/lib/billing/staff-plan";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { resolveCurrentWindow } from "@/lib/billing/ai-usage";

import pool from "@/lib/database/db";
import { getClientIp } from "@/lib/api/request-utils";
import { getSetting } from "@/lib/config/runtime-config";
import {
  ERROR_MESSAGES,
  STAFF_ROLES,
  STAFF_ROLE_HIERARCHY,
  APP_URL,
} from "@/lib/config/constants";
import {
  sendEmail,
  adminNotificationEmail,
  adminAccountChangeEmail,
  passwordResetEmail,
} from "@/lib/email/email";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";

// Helper to send email only if user notification is enabled
async function sendNotificationIfEnabled(
  shouldSend: boolean | undefined,
  to: string,
  emailPayload: { subject: string; text: string; html: string },
  unsubscribeToken?: string,
) {
  if (shouldSend !== false) {
    // default to true if not specified
    sendEmail({ to, ...emailPayload, unsubscribeToken }).catch(console.error);
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
  return _requireStaff();
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
  // Escape LIKE metacharacters so admin search is exact-substring, not a
  // pattern. Without this, typing "%" returns all users (full table scan).
  const searchEscaped = search.replace(/[\\%_]/g, "\\$&");

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
      discordRes,
      githubRepoConnectionRes,
    ] = await Promise.all([
      pool.query(
        `SELECT u.id, u.email, u.name, u.role, u.avatar_url, u.totp_enabled, u.tos_accepted_at, u.created_at, u.disabled_at,
          u.email_verified_at, u.plan, u.stripe_customer_id, u.subscription_status, u.ai_chat_banned,
          u.google_id, u.google_email, u.google_name,
          u.github_id, u.github_email, u.github_name,
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
      // Connected socials: Discord is the only OAuth-style connection this
      // app currently stores server-side (see discord_connections in
      // instrumentation.ts). access_token/refresh_token are deliberately
      // never selected -- an admin has no legitimate need to see or act
      // with a user's live Discord credentials, only whether/when they
      // connected.
      pool.query(
        `SELECT discord_id, discord_username, discord_discriminator, discord_avatar, guild_joined, connected_at
         FROM discord_connections WHERE user_id = $1`,
        [userId],
      ),
      // Separate from the users.github_id sign-in link selected above: this
      // is the distinct repo-read-access feature (code scanning), keyed by
      // github_user_id with its own OAuth scopes/token -- see instrumentation.ts's
      // github_connections comment. access_token_encrypted is deliberately
      // never selected.
      pool.query(
        `SELECT github_username, scopes, connected_at
         FROM github_connections WHERE user_id = $1`,
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
      discordConnection: discordRes.rows[0] || null,
      githubRepoConnection: githubRepoConnectionRes.rows[0] || null,
    });
  }

  // Fetch audit log
  if (section === "audit") {
    // auth: gate audit-log reads to moderator+ (AUDIT-007#audit-01).
    // Support staff are read-only; the audit trail contains admin IPs
    // and action details that exceed the support tier's need-to-know.
    if (
      (STAFF_ROLE_HIERARCHY[session.role] || 0) <
      (STAFF_ROLE_HIERARCHY.moderator || 2)
    ) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.FORBIDDEN },
        { status: 403 },
      );
    }
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
      WHERE u.role IN ('super_admin', 'admin', 'moderator', 'support')
      ORDER BY
        CASE u.role WHEN 'super_admin' THEN -1 WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 WHEN 'support' THEN 2 END,
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
          WHERE u.email ILIKE $3 ESCAPE '\\' OR u.name ILIKE $3 ESCAPE '\\'
          ORDER BY u.created_at DESC
          LIMIT $1 OFFSET $2
        `,
          [limit, offset, `%${searchEscaped}%`],
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
          "SELECT COUNT(*) FROM users WHERE email ILIKE $1 ESCAPE '\\' OR name ILIKE $1 ESCAPE '\\'",
          [`%${searchEscaped}%`],
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
// Moderator: the actions listed in modActions below -- MUST stay a superset
// of every action whose permission ROLE_PERMISSION_MAP[STAFF_ROLES.MODERATOR]
// grants in lib/auth/permissions-client.ts, or the admin panel UI shows a
// moderator a button (gated client-side by hasStaffPermission) that this
// route then 403s (see the false-success dialog + permission-drift fixes,
// AUDIT-010: "disable"/"enable"/"toggle_ai_ban" were missing here even
// though DISABLE_USER/ENABLE_USER/MODERATE_CONTENT are granted to
// moderators client-side).
// Support: GET/view only, no PATCH mutations
function canPerformAction(role: string, action: string): boolean {
  const modActions = [
    "award_badge",
    "revoke_badge",
    "create_badge",
    "delete_badge",
    "update_name",
    "update_email",
    "notify_account_changes",
    "verify_email",
    "unverify_email",
    "revoke_sessions",
    "revoke_api_keys",
    "disable",
    "enable",
    "delete_scans",
    "delete_webhooks",
    "delete_schedules",
    "clear_rate_limits",
    "force_logout_all",
    "add_note",
    "clear_avatar",
    "reset_2fa",
    "send_notification",
    "toggle_ai_ban",
    "gift_subscription",
    "revoke_gift",
    "reset_daily_limit",
    "reset_ai_usage",
    "reset_github_review_usage",
    "reset_free_github_trial",
  ];
  // super_admin passes every check admin passes.
  if (role === STAFF_ROLES.ADMIN || role === STAFF_ROLES.SUPER_ADMIN)
    return true;
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
  // Parse the body once at the top. Several sub-actions previously called
  // `await request.json()` a second time inside the switch — the body stream
  // is single-use, so the second call rejected with `SyntaxError: Unexpected
  // end of JSON input`, silently turning those actions into no-ops.
  const body = await request.json();
  const {
    action,
    userId: rawUserId,
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
    title: notifTitle,
    message: notifMessage,
    type: notifType,
    limit: scanLimit,
  } = body;
  // Normalize IDs to numbers (client may send as string)
  let userId: number | undefined;
  if (rawUserId != null) {
    const numId = Number(rawUserId);
    if (!Number.isInteger(numId) || numId < 1) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    userId = numId;
  }
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
    "SELECT email, totp_enabled, role, plan, name, unsubscribe_token FROM users WHERE id = $1",
    [userId],
  );
  if (!targetRes.rows[0])
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  const targetUser = targetRes.rows[0];

  // super-admin: the designated first-user account cannot be targeted by
  // ANY admin-panel action from anyone else, no matter the caller's own
  // role -- but the super_admin can still act on their OWN account (e.g.
  // awarding themselves a badge, granting a plan). The truly dangerous
  // actions (delete, disable, remove_admin, reset_password, set_role) are
  // already blocked for self-targeting above regardless of role, so this
  // exception only ever opens up the benign, non-destructive actions. This
  // does not touch the super_admin's own normal account routes (profile
  // edits, password change, logout, 2FA); those are separate code paths
  // this route never runs for.
  if (isSuperAdminRole(targetUser.role) && userId !== session.userId) {
    return NextResponse.json(
      { error: "This account cannot be modified." },
      { status: 403 },
    );
  }

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

  // rate-limit: cap re-auth attempts per admin to prevent brute-forcing the
  // admin password through repeated PATCH requests.
  const adminRl = await checkRateLimit({
    key: `admin-reauth:${session.userId}:${ip}`,
    ...RATE_LIMITS.adminReauth,
  });
  if (!adminRl.allowed) {
    return NextResponse.json(
      {
        error: `Too many admin attempts. Try again in ${Math.ceil(adminRl.retryAfterSeconds / 60)} minute(s).`,
      },
      { status: 429 },
    );
  }

  // auth: require password re-entry before any sensitive action. Gate lives
  // OUTSIDE the action switch so it runs before action handlers — the old
  // in-switch gate broke all gated actions (break exited the switch and the
  // actual action handlers were unreachable). Added make_admin and set_role
  // which were missing from the original gate.
  //
  // Keep in sync with PASSWORD_GATED_ACTIONS in components/admin/config.ts.
  // "revoke_all_sessions" was a bug: the real action name sent by the UI is
  // "revoke_sessions" (no "all"), so that action was never actually gated.
  const GATED_ACTIONS = new Set([
    "update_email",
    "update_password",
    "disable",
    "reset_password",
    "delete",
    "revoke_sessions",
    "revoke_api_keys",
    "reset_2fa",
    "force_logout_all",
    "toggle_ai_ban",
    "delete_scans",
    "delete_webhooks",
    "delete_schedules",
    "remove_admin",
    "make_admin",
    "set_role",
    "impersonate",
  ]);
  if (GATED_ACTIONS.has(action)) {
    const currentAdminPassword = body.currentAdminPassword;
    if (
      typeof currentAdminPassword !== "string" ||
      currentAdminPassword.length === 0
    ) {
      return NextResponse.json(
        { error: "Re-enter your password to confirm this action." },
        { status: 403 },
      );
    }
    const adminPwRow = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1",
      [session.userId],
    );
    if (
      !adminPwRow.rows[0] ||
      !(await verifyPassword(
        currentAdminPassword,
        adminPwRow.rows[0].password_hash,
      ))
    ) {
      return NextResponse.json(
        { error: "Password is incorrect." },
        { status: 403 },
      );
    }
  }

  switch (action) {
    case "set_role": {
      // super_admin is un-assignable through this endpoint (or any UI
      // path): it is only ever set by the first-user bootstrap logic in
      // lib/auth/auth.ts::createUser or the 5.5.0-to-5.6.0 migration.
      const validRoles = Object.values(STAFF_ROLES).filter(
        (r) => r !== STAFF_ROLES.SUPER_ADMIN,
      );
      if (!newRole || !validRoles.includes(newRole)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      const oldRole = targetUser.role || "user";
      await pool.query("UPDATE users SET role = $1 WHERE id = $2", [
        newRole,
        userId,
      ]);
      // billing: grant/revoke the real staff plan floor -- see
      // lib/billing/staff-plan.ts. No-ops unless this crosses the
      // staff/non-staff boundary (e.g. admin -> moderator is a no-op).
      await syncPlanForRoleChange(userId, oldRole, newRole);
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
        targetUser.unsubscribe_token,
      );

      return NextResponse.json({
        success: true,
        change: {
          field: "Account Role",
          oldValue: roleLabels[oldRole] || oldRole,
          newValue: roleLabels[newRole] || newRole,
        },
      });
    }

    case "make_admin":
      await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [
        userId,
      ]);
      // billing: see the matching comment in the set_role case above.
      await syncPlanForRoleChange(userId, targetUser.role || "user", "admin");
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
      // billing: see the matching comment in the set_role case above.
      await syncPlanForRoleChange(userId, targetUser.role || "user", "user");
      await logAction(
        session.userId,
        userId,
        "remove_admin",
        `Removed admin from ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });

    case "update_password": {
      const newPassword = body.newPassword;
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters." },
          { status: 400 },
        );
      }
      const newHash = await hashPassword(newPassword);
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [newHash, userId],
      );
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "update_password",
        `Updated password for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "revoke_all_sessions": {
      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "revoke_all_sessions",
        `Revoked all sessions for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

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

      // Same token flow as the self-service forgot-password route
      // (app/api/v3/auth/forgot-password/route.ts): a random token is
      // emailed to the user, only its hash is stored, and the user picks
      // their own new password via the emailed link. The admin never sees
      // or sets the password itself -- a plaintext temp password generated
      // here and shown in the admin UI would mean an admin (and anyone who
      // later reads that browser's network log or the admin's screen)
      // could log in as the user before they ever see the email.
      await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [
        userId,
      ]);
      const resetToken = randomBytes(32).toString("hex");
      const resetTokenHash = createHash("sha256")
        .update(resetToken)
        .digest("hex");
      const passwordResetHours = await getSetting("PASSWORD_RESET_HOURS");
      const resetExpiresAt = new Date(
        Date.now() + passwordResetHours * 60 * 60 * 1000,
      );
      await pool.query(
        "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
        [userId, resetTokenHash, resetExpiresAt],
      );

      await pool.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await logAction(
        session.userId,
        userId,
        "reset_password",
        `Sent a password reset link to ${targetUser.email}`,
        ip,
      );

      const resetLink = `${APP_URL}/reset-password?token=${resetToken}`;
      const emailPayloadPwd = passwordResetEmail(resetLink);
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadPwd,
        targetUser.unsubscribe_token,
      );

      return NextResponse.json({ success: true });
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
        targetUser.unsubscribe_token,
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
        targetUser.unsubscribe_token,
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
        targetUser.unsubscribe_token,
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
        targetUser.unsubscribe_token,
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
        await sendNotificationIfEnabled(
          true,
          targetUser.email,
          emailPayload,
          targetUser.unsubscribe_token,
        );
      }
      return NextResponse.json({
        success: true,
        change: {
          field: "Badge Awarded",
          oldValue: "—",
          newValue: badgeInfo.rows[0].display_name,
        },
      });
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
      // Security: permanently disabled. An admin (even a compromised or
      // malicious one) must never be able to strip a user's second factor
      // -- that's a direct account-takeover path (disable their 2FA, then
      // take over with just the password, or trigger a password reset
      // next, which is itself blocked for a 2FA-enabled account by the
      // reset_password case above). The only sanctioned way off 2FA is the
      // account owner themselves, via their own backup codes or their own
      // recovery flow. Unconditional (not gated on targetUser.totp_enabled
      // the way reset_password is) since there's nothing useful this
      // action could ever do for an account WITHOUT 2FA either -- it always
      // 400s now, matching the UI, which no longer offers this action at
      // all (see components/admin/users/user-detail-panel.tsx).
      return NextResponse.json(
        {
          error:
            "Admin-initiated 2FA reset is disabled. The user must use their own backup codes or their own account recovery flow.",
        },
        { status: 400 },
      );
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
      // Part 3 audit fix: this used to only log the action without ever
      // touching the rate_limits table -- a client-visible "success" that
      // did nothing. rate_limits is a shared bucket table keyed
      // `<name>:<userId>` or `<name>:<userId>:<ip>` across every
      // per-user rate limiter in this app (see lib/rate-limiting/
      // rate-limit.ts's checkRateLimit call sites, and daily_scan:<userId>
      // in lib/rate-limiting/daily-limits.ts) -- anchored on ':' so a
      // userId that's a numeric prefix/suffix of another key's number
      // (e.g. clearing user 5 must not also touch a key for user 50)
      // never matches.
      const clearResult = await pool.query(
        "DELETE FROM rate_limits WHERE key ~ ('(^|:)' || $1::text || '($|:)')",
        [String(userId)],
      );
      await logAction(
        session.userId,
        userId,
        "clear_rate_limits",
        `Cleared ${clearResult.rowCount ?? 0} rate limit bucket(s) for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "reset_daily_limit": {
      // Zeroes today's daily scan counter (lib/rate-limiting/
      // daily-limits.ts's getDailyRequestCount/incrementDailyCount, key
      // `daily_scan:<userId>`, one row per day) so the user can scan
      // again immediately instead of waiting for the midnight UTC reset.
      // Deliberately scoped to just today's row, not every rate_limits
      // row for this user -- see clear_rate_limits above for the broader
      // "reset every rate limiter" action.
      await pool.query(
        "DELETE FROM rate_limits WHERE key = $1 AND window_start >= CURRENT_DATE",
        [`daily_scan:${userId}`],
      );
      await logAction(
        session.userId,
        userId,
        "reset_daily_limit",
        `Reset today's daily scan count for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "reset_ai_usage": {
      // Zeroes the user's current-window ai_usage row (AI chat / finding
      // verification / scan summary tokens, lib/billing/ai-usage.ts) so
      // their aiTokensPerWindow allowance is immediately available again
      // instead of waiting out AI_USAGE_WINDOW_HOURS. Deleting the row
      // (not zeroing tokens_used in place) is equivalent for every
      // reader -- getAiTokensUsed treats a missing row as 0 -- and avoids
      // a redundant UPDATE-vs-DELETE branch.
      const { windowStart: aiWindowStart } = await resolveCurrentWindow();
      await pool.query(
        "DELETE FROM ai_usage WHERE user_id = $1 AND window_start = $2",
        [userId, aiWindowStart],
      );
      await logAction(
        session.userId,
        userId,
        "reset_ai_usage",
        `Reset current-window AI usage for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "reset_github_review_usage": {
      // Same idea as reset_ai_usage above, for GitHub repo AI code review
      // (lib/billing/github-review-usage.ts's githubReviewTokensPerWindow
      // limit, github_review_usage table) -- which resets on the exact
      // same window as ai_usage since the Part 1 cadence change, so the
      // same resolveCurrentWindow() call resolves both.
      const { windowStart: reviewWindowStart } = await resolveCurrentWindow();
      await pool.query(
        "DELETE FROM github_review_usage WHERE user_id = $1 AND window_start = $2",
        [userId, reviewWindowStart],
      );
      await logAction(
        session.userId,
        userId,
        "reset_github_review_usage",
        `Reset current-window GitHub review usage for ${targetUser.email}`,
        ip,
      );
      return NextResponse.json({ success: true });
    }

    case "reset_free_github_trial": {
      // Lets the user use today's free GitHub AI review trial again
      // immediately (lib/billing/github-review-usage.ts's
      // hasUsedFreeGithubReviewToday/markFreeGithubReviewUsed) instead of
      // waiting out the 24-hour cooldown. Unconditional UPDATE, not
      // gated on the column already being set -- setting an
      // already-NULL column to NULL again is a harmless no-op, and
      // requiring a pre-check here would just be an extra round trip for
      // no behavioral difference.
      await pool.query(
        "UPDATE users SET free_github_review_used_at = NULL WHERE id = $1",
        [userId],
      );
      await logAction(
        session.userId,
        userId,
        "reset_free_github_trial",
        `Reset free GitHub review trial for ${targetUser.email}`,
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

    case "toggle_ai_ban": {
      const currentBan = await pool.query<{ ai_chat_banned: boolean }>(
        "SELECT ai_chat_banned FROM users WHERE id = $1",
        [userId],
      );
      const newBan = !currentBan.rows[0]?.ai_chat_banned;
      await pool.query(
        "UPDATE users SET ai_chat_banned = $1, updated_at = NOW() WHERE id = $2",
        [newBan, userId],
      );
      await logAction(
        session.userId,
        userId,
        "toggle_ai_ban",
        `${newBan ? "Banned" : "Unbanned"} ${targetUser.email} from AI chat`,
        ip,
      );
      return NextResponse.json({ success: true, ai_chat_banned: newBan });
    }

    case "send_notification": {
      const title = notifTitle;
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
          targetUser.unsubscribe_token,
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
      // Only admin/super_admin can start an impersonation session, and
      // only against a plain "user"-tier account -- see
      // lib/auth/impersonation.ts's header comment for why staff/admin
      // accounts are never a valid impersonation target.
      if (
        session.role !== STAFF_ROLES.ADMIN &&
        session.role !== STAFF_ROLES.SUPER_ADMIN
      ) {
        return NextResponse.json(
          { error: "Only admins can impersonate users" },
          { status: 403 },
        );
      }
      const result = await startImpersonation(
        session.userId,
        userId,
        ip,
        request.headers.get("user-agent") || undefined,
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: 403 });
      }
      await logAction(
        session.userId,
        userId,
        "impersonate",
        `Started impersonation session for ${result.targetEmail}`,
        ip,
      );
      return NextResponse.json({
        success: true,
        impersonating: result.targetEmail,
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
        targetUser.unsubscribe_token,
      );

      return NextResponse.json({ success: true });
    }

    case "set_scan_limit": {
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
      const maxDescriptionLength = await getSetting("MAX_DESCRIPTION_LENGTH");
      const safeNote = note.trim().slice(0, maxDescriptionLength);
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
      const maxDescriptionLength = await getSetting("MAX_DESCRIPTION_LENGTH");
      const safeNote = note.trim().slice(0, maxDescriptionLength);
      const ownerCheck = await pool.query(
        "SELECT admin_id FROM admin_user_notes WHERE id = $1",
        [noteId],
      );
      if (!ownerCheck.rows[0])
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      const isOwner = ownerCheck.rows[0].admin_id === session.userId;
      if (
        !isOwner &&
        session.role !== STAFF_ROLES.ADMIN &&
        session.role !== STAFF_ROLES.SUPER_ADMIN
      )
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
      if (
        !isOwner &&
        session.role !== STAFF_ROLES.ADMIN &&
        session.role !== STAFF_ROLES.SUPER_ADMIN
      )
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
      await deleteAvatarFilesIfLocal(userId);
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
        targetUser.unsubscribe_token,
      );

      return NextResponse.json({
        success: true,
        change: {
          field: "Display Name",
          oldValue: oldName || "(not set)",
          newValue: safeName || "(cleared)",
        },
      });
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
      // Keeps pre_staff_plan in sync for a currently-staff target -- see
      // that function's own comment for the two bugs this prevents (a
      // manual bump permanently discarding the real original plan, or a
      // manual correction getting silently reverted on the next role
      // change). No-ops for a non-staff target.
      await syncPreStaffPlanForManualPlanChange(
        userId,
        targetUser.role || "user",
        plan,
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
        targetUser.unsubscribe_token,
      );

      return NextResponse.json({
        success: true,
        change: {
          field: "Subscription Plan",
          oldValue: formatPlan(oldPlan),
          newValue: formatPlan(plan),
        },
      });
    }

    // Sends ONE consolidated "your account was updated" email covering
    // every field the admin changed in a single Save (name/plan/role,
    // plus any badges awarded). Used by user-detail-panel.tsx's
    // saveAllChanges, which calls each individual field-update action
    // (set_role/update_name/update_plan/award_badge) with
    // notifyUser:false to suppress their own per-field email, collects
    // the `change` descriptor each of those actions returns, then makes
    // this one call at the end -- instead of the user getting one email
    // per field they touched. update_email is deliberately NOT folded in
    // here: it always sends its own immediate dual notification (old +
    // new address) for account-security reasons, regardless of batching.
    // No DB write, so nothing to undo if this fails -- best-effort only.
    case "notify_account_changes": {
      const rawChanges = Array.isArray(body.changes) ? body.changes : [];
      const changes = rawChanges
        .slice(0, 20)
        .map((c: Record<string, unknown>) => ({
          field: String(c?.field ?? "").slice(0, 100),
          oldValue: String(c?.oldValue ?? "").slice(0, 200),
          newValue: String(c?.newValue ?? "").slice(0, 200),
        }))
        .filter((c: { field: string }) => c.field.length > 0);
      if (changes.length === 0) {
        return NextResponse.json({ success: true });
      }
      const [adminNameC, userNameC] = await Promise.all([
        getAdminName(session.userId),
        getUserName(userId),
      ]);
      const emailPayloadC = adminAccountChangeEmail({
        userName: userNameC,
        adminName: adminNameC,
        changes,
        timestamp: new Date(),
      });
      await sendNotificationIfEnabled(
        notifyUser,
        targetUser.email,
        emailPayloadC,
        targetUser.unsubscribe_token,
      );
      return NextResponse.json({ success: true });
    }

    case "delete":
    case "delete_user":
    case "delete_account": {
      // This permanently deletes a user account - use with caution!
      const userEmail = targetUser.email;
      const userName = targetUser.name || userEmail;

      // Run all deletes inside a single transaction so a mid-way failure
      // doesn't leave the user in a half-deleted state (and to avoid 33+
      // separate connections if the pool happens to be near max). The
      // previous implementation ran each DELETE on its own implicit
      // transaction, so any failure mid-sequence orphaned rows and made
      // a re-delete attempt FK-violate.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await deleteUserAccountData(client, userId);
        await client.query("COMMIT");
      } catch (txError) {
        await client.query("ROLLBACK");
        throw txError;
      } finally {
        client.release();
      }

      // Best-effort: the user row is already gone, so an avatar file left
      // on disk would never be referenced again. Not part of the
      // transaction above (filesystem writes don't roll back with SQL).
      await deleteAvatarFilesIfLocal(userId);

      // targetUserId is null here, not userId: the user row (and every
      // pre-existing admin_audit_log row that referenced it) is already
      // gone by this point. admin_audit_log.target_user_id's FK is
      // ON DELETE SET NULL (instrumentation.ts), which only relaxes the
      // constraint for EXISTING rows when their target is deleted later --
      // it does not permit INSERTing a brand new row that references an id
      // that's already gone. Passing userId here throws a foreign-key
      // violation on every single delete: logAuditAction
      // (lib/auth/authorization.ts) has no internal try/catch, and PATCH
      // has no outer one either, so that exception used to propagate all
      // the way to the client as a 500 -- reporting "Action failed" for a
      // delete that had, in fact, already fully committed. The email is
      // already preserved in the details string below, so nothing is lost
      // by not linking this row to a user id that no longer exists.
      await logAction(
        session.userId,
        null,
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
