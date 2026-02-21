import { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"
import { getNotificationPreferences } from "@/lib/notifications"

const ALL_PREF_COLUMNS = [
  // Security
  "email_security",
  "email_login_alerts",
  "email_password_changes",
  "email_two_factor_changes",
  "email_session_alerts",
  // Scanning
  "email_scan_complete",
  "email_scan_failures",
  "email_severity_alerts",
  "email_schedules",
  // API & Integrations
  "email_api_keys",
  "email_api_usage_alerts",
  "email_webhooks",
  "email_webhook_failures",
  // Account
  "email_data_requests",
  "email_account_changes",
  "email_team_invites",
  // Product
  "email_product_updates",
  "email_tips_guides",
] as const

// GET: Fetch notification preferences
export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const prefs = await getNotificationPreferences(session.userId)
  return ApiResponse.success(prefs)
})

// PUT: Update notification preferences
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const parsed = await parseBody<Record<string, boolean>>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const data = parsed.data

  // Validate: only accept known columns, all must be booleans
  const updates: Record<string, boolean> = {}
  for (const col of ALL_PREF_COLUMNS) {
    if (col in data) {
      if (typeof data[col] !== "boolean") {
        return ApiResponse.badRequest(`Invalid value for ${col}`)
      }
      updates[col] = data[col]
    }
  }

  if (Object.keys(updates).length === 0) {
    return ApiResponse.badRequest("No valid preferences provided.")
  }

  // Build dynamic upsert
  const cols = Object.keys(updates)
  const vals = Object.values(updates)
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(", ")
  const insertCols = ["user_id", ...cols].join(", ")
  const insertVals = cols.map((_, i) => `$${i + 2}`).join(", ")

  const result = await pool.query(
    `INSERT INTO notification_preferences (${insertCols}, updated_at)
     VALUES ($1, ${insertVals}, NOW())
     ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = NOW()
     RETURNING *`,
    [session.userId, ...vals],
  )

  return ApiResponse.success(result.rows[0], 200)
})
