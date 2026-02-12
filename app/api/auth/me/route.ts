import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // Get 2FA and admin status
  const result = await pool.query(
    "SELECT totp_enabled, is_admin, onboarding_completed FROM users WHERE id = $1",
    [session.userId],
  )
  const user = result.rows[0]

  return ApiResponse.success({
    userId: session.userId,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tosAcceptedAt,
    totpEnabled: user?.totp_enabled || false,
    isAdmin: user?.is_admin || false,
    onboardingCompleted: user?.onboarding_completed || false,
  })
})
