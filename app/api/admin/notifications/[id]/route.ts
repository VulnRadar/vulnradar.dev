import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session || !hasStaffPermission(session.role, STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const {
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
    } = body

    const result = await db.query(
      `UPDATE admin_notifications SET
        title = COALESCE($1, title),
        message = COALESCE($2, message),
        type = COALESCE($3, type),
        variant = COALESCE($4, variant),
        audience = COALESCE($5, audience),
        path_pattern = $6,
        starts_at = COALESCE($7, starts_at),
        ends_at = $8,
        is_active = COALESCE($9, is_active),
        is_dismissible = COALESCE($10, is_dismissible),
        dismiss_duration_hours = $11,
        action_label = $12,
        action_url = $13,
        action_external = COALESCE($14, action_external),
        priority = COALESCE($15, priority),
        updated_at = NOW()
      WHERE id = $16
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
        id,
      ]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    return NextResponse.json({ notification: result.rows[0] })
  } catch (error) {
    console.error("Error updating notification:", error)
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session || !hasStaffPermission(session.role, STAFF_PERMISSIONS.SEND_ANNOUNCEMENTS)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const result = await db.query(
      `DELETE FROM admin_notifications WHERE id = $1 RETURNING id`,
      [id]
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting notification:", error)
    return NextResponse.json({ error: "Failed to delete notification" }, { status: 500 })
  }
}
