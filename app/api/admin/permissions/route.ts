import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, STAFF_ROLES } from "@/lib/constants"

export const GET = withErrorHandling(async (req: Request) => {
  const session = await getSession()
  if (!session || session.role !== STAFF_ROLES.ADMIN) {
    return ApiResponse.forbidden(ERROR_MESSAGES.FORBIDDEN)
  }

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get("userId")

  if (!userId) {
    return ApiResponse.badRequest("userId is required")
  }

  const result = await pool.query(
    `SELECT up.permission_name FROM user_permissions up WHERE up.user_id = $1 ORDER BY up.permission_name`,
    [userId],
  )

  return ApiResponse.success(result.rows.map((row: any) => row.permission_name))
})

export const POST = withErrorHandling(async (req: Request) => {
  const session = await getSession()
  if (!session || session.role !== STAFF_ROLES.ADMIN) {
    return ApiResponse.forbidden(ERROR_MESSAGES.FORBIDDEN)
  }

  const body = await req.json()
  const { userId, permission } = body

  if (!userId || !permission) {
    return ApiResponse.badRequest("userId and permission are required")
  }

  // Insert permission
  await pool.query(
    `INSERT INTO user_permissions (user_id, permission_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, permission],
  )

  // Log admin action
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details) VALUES ($1, $2, $3, $4)`,
    [session.userId, userId, "assign_permission", `Assigned permission: ${permission}`],
  )

  return ApiResponse.success({ message: "Permission assigned" })
})

export const DELETE = withErrorHandling(async (req: Request) => {
  const session = await getSession()
  if (!session || session.role !== STAFF_ROLES.ADMIN) {
    return ApiResponse.forbidden(ERROR_MESSAGES.FORBIDDEN)
  }

  const body = await req.json()
  const { userId, permission } = body

  if (!userId || !permission) {
    return ApiResponse.badRequest("userId and permission are required")
  }

  // Remove permission
  await pool.query(`DELETE FROM user_permissions WHERE user_id = $1 AND permission_name = $2`, [userId, permission])

  // Log admin action
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details) VALUES ($1, $2, $3, $4)`,
    [session.userId, userId, "remove_permission", `Removed permission: ${permission}`],
  )

  return ApiResponse.success({ message: "Permission removed" })
})
