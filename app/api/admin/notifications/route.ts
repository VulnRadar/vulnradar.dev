import { NextResponse } from "next/server"
import pool from "@/lib/db"
import { getSession } from "@/lib/auth"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"

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
  } catch (error) {
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

    const result = await pool.query(
      `INSERT INTO admin_notifications (
        title, message, type, variant, audience, path_pattern,
        starts_at, ends_at, is_active, is_dismissible, dismiss_duration_hours,
        action_label, action_url, action_external, priority, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
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

    return NextResponse.json({ notification: result.rows[0] })
  } catch (error) {
    console.error("Error creating notification:", error)
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 })
  }
}
