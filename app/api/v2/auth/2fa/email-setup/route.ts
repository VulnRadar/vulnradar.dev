import { NextRequest } from "next/server"
import { getSession, verifyPassword } from "@/lib/auth"
import { email2FAEnabledEmail, email2FADisabledEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"
import { getClientIp, getUserAgent } from "@/lib/request-utils"

// POST - Enable email 2FA
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return ApiResponse.badRequest("Invalid request body.")
  }
  const { password } = body
  if (!password) return ApiResponse.badRequest("Password is required.")

  const { rows } = await pool.query(
    "SELECT password_hash, totp_enabled, two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  )
  if (rows.length === 0) return ApiResponse.notFound("User not found.")

  const valid = verifyPassword(password, rows[0].password_hash)
  if (!valid) return ApiResponse.forbidden("Incorrect password.")

  if (rows[0].totp_enabled && rows[0].two_factor_method === "app") {
    return ApiResponse.badRequest("Disable authenticator app 2FA first.")
  }

  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
    [session.userId],
  )

  // Non-blocking notification email
  const ip = await getClientIp()
  const ua = await getUserAgent()
  const emailContent = email2FAEnabledEmail({ ipAddress: ip || "Unknown", userAgent: ua || "Unknown" })
  setImmediate(() => {
    sendNotificationEmail({ userId: session.userId, userEmail: rows[0].email, type: "two_factor_changes", emailContent })
      .catch((err) => console.error("Failed to send email 2FA enabled notification:", err))
  })

  return ApiResponse.success({ success: true })
})

// DELETE - Disable email 2FA
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return ApiResponse.badRequest("Invalid request body.")
  }
  const { password } = body
  if (!password) return ApiResponse.badRequest("Password is required.")

  const { rows } = await pool.query(
    "SELECT password_hash, two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  )
  if (rows.length === 0) return ApiResponse.notFound("User not found.")

  const valid = verifyPassword(password, rows[0].password_hash)
  if (!valid) return ApiResponse.forbidden("Incorrect password.")

  if (rows[0].two_factor_method !== "email") {
    return ApiResponse.badRequest("Email 2FA is not enabled.")
  }

  await pool.query(
    "UPDATE users SET totp_enabled = false, two_factor_method = NULL WHERE id = $1",
    [session.userId],
  )
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [session.userId])

  // Non-blocking notification email
  const ip = await getClientIp()
  const ua = await getUserAgent()
  const emailContent = email2FADisabledEmail({ ipAddress: ip || "Unknown", userAgent: ua || "Unknown" })
  setImmediate(() => {
    sendNotificationEmail({ userId: session.userId, userEmail: rows[0].email, type: "two_factor_changes", emailContent })
      .catch((err) => console.error("Failed to send email 2FA disabled notification:", err))
  })

  return ApiResponse.success({ success: true })
})
