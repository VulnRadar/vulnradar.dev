import { NextRequest } from "next/server"
import pool from "@/lib/db"
import { hashPassword } from "@/lib/auth"
import { passwordChangedEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { ApiResponse, parseBody, Validate, withErrorHandling } from "@/lib/api-utils"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp()
  const userAgent = await getUserAgent()
  
  const parsed = await parseBody<{ token: string; password: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { token, password } = parsed.data

  const validationError = Validate.multiple([
    Validate.required(token, "Token"),
    Validate.required(password, "Password"),
    Validate.password(password, 12), // Using 12 char minimum from constants
  ])
  if (validationError) return ApiResponse.badRequest(validationError)

  // Find valid token - atomic check and mark as used in single transaction
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    const tokenRes = await client.query(
      `SELECT prt.id, prt.user_id, prt.expires_at, u.email, u.totp_enabled
       FROM password_reset_tokens prt
       JOIN users u ON prt.user_id = u.id
       WHERE prt.token_hash = $1 AND prt.used_at IS NULL
       FOR UPDATE`,
      [token],
    )

    if (tokenRes.rows.length === 0) {
      await client.query("ROLLBACK")
      return ApiResponse.badRequest("Invalid or expired reset link.")
    }

    const resetToken = tokenRes.rows[0]

    if (new Date(resetToken.expires_at) < new Date()) {
      await client.query("DELETE FROM password_reset_tokens WHERE id = $1", [resetToken.id])
      await client.query("COMMIT")
      return ApiResponse.badRequest("This reset link has expired. Please request a new one.")
    }

    // Hash new password and update
    const passwordHash = hashPassword(password)
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, resetToken.user_id])

    // Mark token as used immediately to prevent duplicate processing
    await client.query("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1", [resetToken.id])

    // Kill all existing sessions for security
    await client.query("DELETE FROM sessions WHERE user_id = $1", [resetToken.user_id])

    await client.query("COMMIT")

    // Send security notification email in background (only after successful commit)
    const emailContent = passwordChangedEmail(resetToken.totp_enabled, {
      ipAddress: ip,
      userAgent: userAgent,
    })

    setImmediate(() => {
      sendNotificationEmail({
        userId: resetToken.user_id,
        userEmail: resetToken.email,
        type: "security",
        emailContent,
      }).catch((err) => {
        console.error("[Email Error] Password change notification failed:", err)
      })
    })

    const responseMessage = resetToken.totp_enabled
      ? "Password has been reset successfully. You can now log in with your new password and 2FA code."
      : "Password has been reset successfully. You can now log in."

    return ApiResponse.success({ message: responseMessage })
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }
})
