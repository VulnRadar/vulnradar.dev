import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { STAFF_ROLE_HIERARCHY } from "@/lib/constants"
import { getClientIP } from "@/lib/rate-limit"

// POST - Update staff member's activity heartbeat
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify user is staff
    const userResult = await pool.query("SELECT role FROM users WHERE id = $1", [session.userId])
    const user = userResult.rows[0]
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const role = user.role || "user"
    if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)) {
      return NextResponse.json({ error: "Not authorized as staff" }, { status: 403 })
    }

    const { section } = await request.json()
    const ip = await getClientIP()
    const userAgent = request.headers.get("user-agent") || "unknown"

    // Update or insert activity record
    const result = await pool.query(
      `INSERT INTO staff_activity (user_id, last_heartbeat, current_section, ip_address, user_agent)
       VALUES ($1, NOW(), $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         last_heartbeat = NOW(),
         current_section = $2,
         ip_address = $3,
         user_agent = $4
       RETURNING user_id, last_heartbeat, is_active`,
      [session.userId, section || "dashboard", ip, userAgent]
    )

    return NextResponse.json({
      success: true,
      activity: result.rows[0],
    })
  } catch (error) {
    console.error("[Admin Activity] Heartbeat error:", error)
    return NextResponse.json({ error: "Failed to update activity" }, { status: 500 })
  }
}

// GET - Fetch all active staff members
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    // Verify user is staff
    const userResult = await pool.query("SELECT role FROM users WHERE id = $1", [session.userId])
    const user = userResult.rows[0]
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

    const role = user.role || "user"
    if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.support || 1)) {
      return NextResponse.json({ error: "Not authorized as staff" }, { status: 403 })
    }

    // Get all staff with their activity status
    const staffResult = await pool.query(
      `SELECT 
         u.id,
         u.email,
         u.name,
         u.role,
         u.avatar_url,
         sa.last_heartbeat,
         sa.is_active,
         sa.current_section,
         EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat))::INT as seconds_since_heartbeat,
         (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id AND al.created_at > NOW() - INTERVAL '5 minutes')::INT as recent_actions
       FROM users u
       LEFT JOIN staff_activity sa ON u.id = sa.user_id
       WHERE u.role IN ('admin', 'moderator', 'support')
       ORDER BY
         CASE WHEN sa.is_active THEN 0 ELSE 1 END,
         sa.last_heartbeat DESC NULLS LAST,
         u.role IN ('admin') DESC,
         u.email ASC`
    )

    return NextResponse.json({
      staff: staffResult.rows,
      timestamp: new Date(),
    })
  } catch (error) {
    console.error("[Admin Activity] Fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }
}
