import { NextResponse } from "next/server"
import pool from "@/lib/database/db"
import { getSession } from "@/lib/auth"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/auth/permissions-client"

async function logAction(adminId: number, action: string, details?: string, ip?: string) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, null, action, details || null, ip || null],
  )
}

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !hasStaffPermission(session.role, STAFF_PERMISSIONS.VIEW_USERS)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await pool.query(
      `SELECT * FROM admin_notifications ORDER BY priority DESC, created_at DESC`
    )

    return NextResponse.json({ notifications: result.rows })
  } catch (_error) {
    console.error("Error fetching notifications:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session || !hasStaffPermission(session.role, STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    const body = await req.json()
    const {
      title,
      message,
      type = "bell",
      variant = "info",
      audience = "all",
      path_pattern,
      starts_at,
      ends_at,
      is_active = true,
      is_dismissible = true,
      dismiss_duration_hours,
      action_label,
      action_url,
      action_external = false,
      priority = 0,
    } = body

    if (!title || !message) {
      return NextResponse.json({ error: "Title and message are required" }, { status: 400 })
    }

    // Generate unique cookie_id: notif_ + 16 random hex chars
    const cookieId = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

    const result = await pool.query(
      `INSERT INTO admin_notifications (
        cookie_id, title, message, type, variant, audience, path_pattern,
        starts_at, ends_at, is_active, is_dismissible, dismiss_duration_hours,
        action_label, action_url, action_external, priority, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *`,
      [
        cookieId,
        title,
        message,
        type,
        variant,
        audience,
        path_pattern,
        starts_at,
        ends_at,
        is_active,
        is_dismissible,
        dismiss_duration_hours,
        action_label,
        action_url,
        action_external,
        priority,
        session.userId,
      ]
    )

    await logAction(session.userId, "notification_created", `Created ${type} notification: "${title}" (audience: ${audience})`, ip)

    return NextResponse.json({ notification: result.rows[0] })
  } catch (_error) {
    console.error("Error creating notification:", error)
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 })
  }
}
