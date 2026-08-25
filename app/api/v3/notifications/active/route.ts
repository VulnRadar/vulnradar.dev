import pool from "@/lib/database/db";
import { getSession, isStaffRole } from "@/lib/auth";

export async function GET() {
  try {
    // Derive audience privilege from the SERVER session, never from client
    // query params. The old handler bound `?authenticated=true&staff=true`
    // straight into the SQL audience gate, so any caller could self-elevate
    // to receive staff/admin-only broadcasts. The session cookie is the only
    // trustworthy source of who the caller is.
    const session = await getSession();
    const isAuthenticated = !!session?.userId;
    const isStaff = isAuthenticated && isStaffRole(session?.role);

    const now = new Date();

    // Fetch active notifications matching criteria
    // Audience logic:
    // - "all" = everyone
    // - "authenticated" = logged in users only
    // - "unauthenticated" = guests only
    // - "staff" / "admin" = staff members only
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
         OR (audience = 'admin' AND $3)
       )
       ORDER BY priority DESC, created_at DESC`,
      [now, isAuthenticated, isStaff],
    );

    return Response.json(result.rows);
  } catch (error) {
    console.error("Error fetching active notifications:", error);
    return Response.json(
      { error: "Failed to fetch notifications" },
      { status: 500 },
    );
  }
}
