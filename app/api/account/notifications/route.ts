import { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, Validate, parseBody, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"
import { getNotificationPreferences } from "@/lib/notifications"

// GET: Fetch notification preferences
export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const prefs = await getNotificationPreferences(session.userId)
  return ApiResponse.success(prefs)
})

// PUT: Update notification preferences
export const PUT = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const parsed = await parseBody<{
    email_api_keys: boolean
    email_webhooks: boolean
    email_schedules: boolean
    email_data_requests: boolean
    email_security: boolean
  }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security } = parsed.data

  // Validate all fields are booleans
  const fields = { email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security }
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "boolean") {
      return ApiResponse.badRequest(`Invalid value for ${key}`)
    }
  }

  // Upsert preferences
  const result = await pool.query(
    `INSERT INTO notification_preferences (user_id, email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       email_api_keys = $2,
       email_webhooks = $3,
       email_schedules = $4,
       email_data_requests = $5,
       email_security = $6,
       updated_at = NOW()
     RETURNING email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security`,
    [session.userId, email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security]
  )

  return ApiResponse.success(result.rows[0], 200)
})
