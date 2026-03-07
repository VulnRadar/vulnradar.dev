import { getSession, destroySession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // CASCADE in the DB schema will delete all related data:
  // sessions, api_keys, api_usage (via api_keys cascade), scan_history, data_requests
  await pool.query("DELETE FROM users WHERE id = $1", [session.userId])

  // Clear the session cookie
  await destroySession()

  return ApiResponse.success({ message: "Account deleted successfully" })
})
