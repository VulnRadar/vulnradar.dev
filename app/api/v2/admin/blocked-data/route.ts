import { NextResponse } from "next/server"
import pool from "@/lib/database/db"
import { verifySession } from "@/lib/auth/session-server"
import { logAuditAction } from "@/lib/audit/server"
import { hasStaffPermission, STAFF_PERMISSIONS } from "@/lib/auth/permissions"

export async function POST(request: Request) {
  try {
    const session = await verifySession()
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Check admin permission
    if (!hasStaffPermission(session.user.role, STAFF_PERMISSIONS.MANAGE_ACCESS_RULES)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { action, value } = body

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 })
    }

    switch (action) {
      case "find_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 })
        }

        // Find scans matching the blocked URL or domain
        // Match exact URL, domain, or subdomain
        const result = await pool.query(`
          SELECT 
            sh.id,
            sh.url,
            sh.scan_type,
            sh.created_at,
            sh.user_id,
            u.email as user_email
          FROM scan_history sh
          LEFT JOIN users u ON sh.user_id = u.id
          WHERE 
            LOWER(sh.url) = LOWER($1)
            OR LOWER(sh.url) LIKE LOWER($1) || '%'
            OR LOWER(sh.url) LIKE '%://' || LOWER($1) || '%'
            OR LOWER(sh.url) LIKE '%.' || LOWER($1) || '%'
          ORDER BY sh.created_at DESC
          LIMIT 100
        `, [value])

        return NextResponse.json({ scans: result.rows })
      }

      case "delete_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 })
        }

        // Delete all scans matching the blocked URL or domain
        const result = await pool.query(`
          DELETE FROM scan_history
          WHERE 
            LOWER(url) = LOWER($1)
            OR LOWER(url) LIKE LOWER($1) || '%'
            OR LOWER(url) LIKE '%://' || LOWER($1) || '%'
            OR LOWER(url) LIKE '%.' || LOWER($1) || '%'
          RETURNING id
        `, [value])

        const deletedCount = result.rowCount || 0

        // Log audit action
        await logAuditAction({
          userId: session.user.id,
          action: "blocked_data_delete",
          targetType: "scan_history",
          details: {
            blocked_value: value,
            deleted_count: deletedCount,
          },
        })

        return NextResponse.json({ 
          success: true, 
          deletedCount,
          message: `Deleted ${deletedCount} scan(s) matching "${value}"`
        })
      }

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }
  } catch (error) {
    console.error("[Admin Blocked Data] Error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
