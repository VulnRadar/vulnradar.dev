import pool from "@/lib/database/db";

/**
 * How long one opening of an account's record covers the panel's own reloads
 * of it. The panel reloads the record after every save, so a ten-field edit
 * used to write ten view_user_detail rows for one look at the account.
 */
export const USER_DETAIL_VIEW_WINDOW_MINUTES = 15;

/**
 * Whether this staff member's view of this account is already in the audit
 * log within the window.
 *
 * The admin route skips a new view row only when the request says it is a
 * refresh AND this returns true. The flag alone cannot decide it: it comes
 * from the client, so trusting it would let anyone with the panel read an
 * account's record without a trace by adding it to their first request.
 * Served by idx_admin_audit_admin_created (admin_id, created_at DESC).
 */
export async function hasRecentUserDetailView(
  adminId: number,
  targetUserId: number,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 AS viewed
       FROM admin_audit_log
      WHERE admin_id = $1
        AND target_user_id = $2
        AND action = 'view_user_detail'
        AND created_at > NOW() - make_interval(mins => $3)
      LIMIT 1`,
    [adminId, targetUserId, USER_DETAIL_VIEW_WINDOW_MINUTES],
  );
  return result.rows.length > 0;
}
