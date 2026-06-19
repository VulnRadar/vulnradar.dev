import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/database/db"
import { getSession } from "@/lib/auth"
import { getClientIp } from "@/lib/api/request-utils"
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants"

async function logAction(adminId: number, targetUserId: number | null, action: string, details?: string, ip?: string) {
  await pool.query(
    "INSERT INTO admin_audit_log (admin_id, target_user_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)",
    [adminId, targetUserId, action, details || null, ip || null],
  )
}

async function requireAdmin() {
  const session = await getSession()
  if (!session) return null
  const result = await pool.query("SELECT id, role FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user) return null
  const role = user.role || "user"
  if ((STAFF_ROLE_HIERARCHY[role] || 0) < (STAFF_ROLE_HIERARCHY.admin || 3)) return null
  return { ...session, id: user.id, role }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const ip = await getClientIp()
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

        // Normalize the domain (strip protocol if accidentally included)
        let normalizedValue = value.trim().toLowerCase()
        
        // Remove protocol using indexOf instead of regex
        const protoEnd = normalizedValue.indexOf("://")
        if (protoEnd !== -1) {
          normalizedValue = normalizedValue.substring(protoEnd + 3)
        }
        
        // Remove path using indexOf instead of regex
        const pathIndex = normalizedValue.indexOf("/")
        if (pathIndex !== -1) {
          normalizedValue = normalizedValue.substring(0, pathIndex)
        }

        // Find scans matching the blocked domain
        // Uses a subquery to extract hostname from URL and match:
        // - Exact domain match (example.com)
        // - Subdomain match (sub.example.com)
        // The regex extracts the hostname from URLs like http://example.com/path
        const result = await pool.query(`
          SELECT 
            sh.id,
            sh.url,
            sh.source,
            sh.scanned_at,
            sh.user_id,
            u.email as user_email
          FROM scan_history sh
          LEFT JOIN users u ON sh.user_id = u.id
          WHERE 
            -- Extract hostname from URL and check if it matches or is subdomain
            (
              -- Match domain exactly after stripping protocol
              LOWER(REGEXP_REPLACE(sh.url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) = LOWER($1)
              -- Match subdomain (hostname ends with .domain)
              OR LOWER(REGEXP_REPLACE(sh.url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) LIKE '%.' || LOWER($1)
            )
          ORDER BY sh.scanned_at DESC
          LIMIT 100
        `, [normalizedValue])

        // Log the search action
        await logAction(user.id, null, "blocked_data_search", `Searched for scans matching blocked value: ${value} (found ${result.rows.length} results)`, ip)

        return NextResponse.json({ scans: result.rows })
      }

      case "delete_scans": {
        if (!value) {
          return NextResponse.json({ error: "Missing value" }, { status: 400 })
        }

        // Normalize the domain
        let normalizedValue = value.trim().toLowerCase()
        
        // Remove protocol using indexOf instead of regex
        const protoEnd = normalizedValue.indexOf("://")
        if (protoEnd !== -1) {
          normalizedValue = normalizedValue.substring(protoEnd + 3)
        }
        
        // Remove path using indexOf instead of regex
        const pathIndex = normalizedValue.indexOf("/")
        if (pathIndex !== -1) {
          normalizedValue = normalizedValue.substring(0, pathIndex)
        }

        // Delete all scans matching the blocked domain (exact or subdomain)
        const result = await pool.query(`
          DELETE FROM scan_history
          WHERE 
            -- Match domain exactly after stripping protocol
            LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) = LOWER($1)
            -- Match subdomain (hostname ends with .domain)
            OR LOWER(REGEXP_REPLACE(url, '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/]+).*$', '\\1')) LIKE '%.' || LOWER($1)
          RETURNING id
        `, [normalizedValue])

        const deletedCount = result.rowCount || 0

        // Log audit action
        await logAction(user.id, null, "blocked_data_delete", `Deleted ${deletedCount} scans for blocked value: ${value}`, ip)

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
