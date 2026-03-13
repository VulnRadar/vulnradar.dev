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
      `INSERT INTO staff_activity (user_id, last_heartbeat, current_section, ip_address, user_agent, updated_at)
       VALUES ($1, NOW(), $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         last_heartbeat = NOW(),
         current_section = $2,
         ip_address = $3,
         user_agent = $4,
         updated_at = NOW()
       RETURNING user_id, last_heartbeat, current_section`,
      [session.userId, section || "dashboard", ip, userAgent]
    )

    return NextResponse.json({
      success: true,
      activity: {
        ...result.rows[0],
        is_active: true, // Just sent heartbeat, so is active
      },
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
    // is_active = true only if heartbeat exists AND was within last 120 seconds
    const staffResult = await pool.query(
      `SELECT 
         u.id,
         u.email,
         u.name,
         u.role,
         u.avatar_url,
         sa.last_heartbeat,
         sa.current_section,
         CASE WHEN sa.last_heartbeat IS NOT NULL THEN EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat))::INT ELSE NULL END as seconds_since_heartbeat,
         CASE WHEN sa.last_heartbeat IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat)) < 120 THEN true ELSE false END as is_active,
         (SELECT COUNT(*) FROM admin_audit_log al WHERE al.admin_id = u.id AND al.created_at > NOW() - INTERVAL '5 minutes')::INT as recent_actions
       FROM users u
       LEFT JOIN staff_activity sa ON u.id = sa.user_id
       WHERE u.role IN ('admin', 'moderator', 'support')
       ORDER BY
         CASE WHEN sa.last_heartbeat IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - sa.last_heartbeat)) < 120 THEN 0 ELSE 1 END,
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
