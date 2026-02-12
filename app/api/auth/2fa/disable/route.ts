import { NextRequest } from "next/server"
import { getSession, verifyPassword } from "@/lib/auth"
import { twoFactorDisabledEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { ApiResponse, parseBody, Validate, withErrorHandling } from "@/lib/api-utils"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const parsed = await parseBody<{ password: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { password } = parsed.data

  const passwordError = Validate.required(password, "Current password")
  if (passwordError) return ApiResponse.badRequest(passwordError)

  // Verify password
  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [session.userId])
  const user = result.rows[0]
  if (!user || !verifyPassword(password, user.password_hash)) {
    return ApiResponse.unauthorized("Incorrect password.")
  }

  // Disable 2FA and clear backup codes
  await pool.query(
    "UPDATE users SET totp_enabled = false, totp_secret = NULL, backup_codes = NULL WHERE id = $1",
    [session.userId],
  )

  // Send security notification email (don't await)
  const ip = await getClientIp()
  const userAgent = await getUserAgent()

  const emailContent = twoFactorDisabledEmail({ ipAddress: ip, userAgent })
  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "security",
    emailContent,
  }).catch((err) => console.error("[Email Error] Failed to send 2FA disabled notification:", err))

  return ApiResponse.success({ message: SUCCESS_MESSAGES.TWO_FA_DISABLED })
})
