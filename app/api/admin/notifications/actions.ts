"use server"

import { createClient } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/permissions-client"

export async function getNotifications() {
  const db = createClient()
  const result = await db.query(
    `SELECT id, title, message, type, variant, audience, path_pattern, starts_at, ends_at, 
            is_active, is_dismissible, dismiss_duration_hours, action_label, action_url, 
            action_external, priority, created_by, created_at, updated_at
     FROM admin_notifications
     ORDER BY priority DESC, created_at DESC`
  )
  return result.rows
}

export async function createNotification(data: any) {
  const user = await getCurrentUser()
  if (!user || !hasStaffPermission(user.role, STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS)) {
    throw new Error("Unauthorized")
  }

  const db = createClient()
  const result = await db.query(
    `INSERT INTO admin_notifications (title, message, type, variant, audience, path_pattern,
                                       starts_at, ends_at, is_active, is_dismissible,
                                       dismiss_duration_hours, action_label, action_url,
                                       action_external, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      data.title,
      data.message,
      data.type || "bell",
      data.variant || "info",
      data.audience || "all",
      data.path_pattern || null,
      data.starts_at || new Date(),
      data.ends_at || null,
      data.is_active !== false,
      data.is_dismissible !== false,
      data.dismiss_duration_hours || null,
      data.action_label || null,
      data.action_url || null,
      data.action_external === true,
      data.priority || 0,
      user.id,
    ]
  )
  return result.rows[0]
}

export async function updateNotification(id: number, data: any) {
  const user = await getCurrentUser()
  if (!user || !hasStaffPermission(user.role, STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS)) {
    throw new Error("Unauthorized")
  }

  const db = createClient()
  const result = await db.query(
    `UPDATE admin_notifications
     SET title = COALESCE($1, title),
         message = COALESCE($2, message),
         type = COALESCE($3, type),
         variant = COALESCE($4, variant),
         audience = COALESCE($5, audience),
         path_pattern = COALESCE($6, path_pattern),
         starts_at = COALESCE($7, starts_at),
         ends_at = COALESCE($8, ends_at),
         is_active = COALESCE($9, is_active),
         is_dismissible = COALESCE($10, is_dismissible),
         dismiss_duration_hours = COALESCE($11, dismiss_duration_hours),
         action_label = COALESCE($12, action_label),
         action_url = COALESCE($13, action_url),
         action_external = COALESCE($14, action_external),
         priority = COALESCE($15, priority)
     WHERE id = $16
     RETURNING *`,
    [
      data.title,
      data.message,
      data.type,
      data.variant,
      data.audience,
      data.path_pattern,
      data.starts_at,
      data.ends_at,
      data.is_active,
      data.is_dismissible,
      data.dismiss_duration_hours,
      data.action_label,
      data.action_url,
      data.action_external,
      data.priority,
      id,
    ]
  )
  return result.rows[0]
}

export async function deleteNotification(id: number) {
  const user = await getCurrentUser()
  if (!user || !hasStaffPermission(user.role, STAFF_PERMISSIONS.MANAGE_NOTIFICATIONS)) {
    throw new Error("Unauthorized")
  }

  const db = createClient()
  await db.query(`DELETE FROM admin_notifications WHERE id = $1`, [id])
}
