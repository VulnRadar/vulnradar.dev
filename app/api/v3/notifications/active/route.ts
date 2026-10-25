import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { getSession, isStaffRole } from "@/lib/auth";
import { withErrorHandling } from "@/lib/api/api-utils";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";
import { logError } from "@/lib/logging/log";

/**
 * "Admins only" is the admin tier and above, the same line requireAdmin()
 * draws. isStaffRole() is true for every role with any permission (support,
 * billing, ops, moderator ...), so using it for both audiences showed an
 * admin-targeted notice (an incident note, a credential rotation) to every
 * specialist account.
 */
function isAdminRole(role: string | null | undefined): boolean {
  return (STAFF_ROLE_HIERARCHY[role ?? ""] ?? 0) >= STAFF_ROLE_HIERARCHY.admin;
}

export const GET = withErrorHandling(async () => {
  try {
    // Derive audience privilege from the SERVER session, never from client
    // query params. The old handler bound `?authenticated=true&staff=true`
    // straight into the SQL audience gate, so any caller could self-elevate
    // to receive staff/admin-only broadcasts. The session cookie is the only
    // trustworthy source of who the caller is.
    const session = await getSession();
    const isAuthenticated = !!session?.userId;
    const isStaff = isAuthenticated && isStaffRole(session?.role);
    const isAdmin = isAuthenticated && isAdminRole(session?.role);

    const now = new Date();

    // Fetch active notifications matching criteria
    // Audience logic:
    // - "all" = everyone
    // - "authenticated" = logged in users only
    // - "unauthenticated" = guests only
    // - "staff" = any staff role
    // - "admin" = admin and super_admin only
    const result = await pool.query(
      `SELECT id, cookie_id, title, message, type, variant, audience, path_pattern, is_active,
              is_dismissible, dismiss_duration_hours, action_label, action_url, action_external,
              action_label_2, action_url_2, action_external_2, priority
       FROM admin_notifications
       WHERE is_active = true
       AND (starts_at IS NULL OR starts_at <= $1)
       AND (ends_at IS NULL OR ends_at > $1)
       AND (
         audience = 'all'
         OR (audience = 'authenticated' AND $2)
         OR (audience = 'unauthenticated' AND NOT $2)
         OR (audience = 'staff' AND $3)
         OR (audience = 'admin' AND $4)
       )
       ORDER BY priority DESC, created_at DESC`,
      [now, isAuthenticated, isStaff, isAdmin],
    );

    // Named envelope, like every other collection route. The client already
    // accepted both shapes, so this needed no coordinated change there.
    return NextResponse.json({ notifications: result.rows });
  } catch (error) {
    logError("notifications", "failed to fetch active notifications", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
});
