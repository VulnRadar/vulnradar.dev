import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  await pool.query(
    "UPDATE users SET tos_accepted_at = NOW() WHERE id = $1",
    [session.userId],
  )

  return ApiResponse.success({ message: SUCCESS_MESSAGES.SETTINGS_UPDATED })
})
