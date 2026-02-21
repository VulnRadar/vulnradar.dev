import { NextRequest } from "next/server"
import { getSession, verifyPassword } from "@/lib/auth"
import { email2FAEnabledEmail, email2FADisabledEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"
import { getClientIp, getUserAgent } from "@/lib/request-utils"

// POST - Enable email 2FA
export const POST = withErrorHandling(async (request: NextRequest) => {
  console.log("[v0] email-setup POST handler entered")
  const session = await getSession()
  console.log("[v0] session:", session ? session.userId : "null")
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const parsed = await parseBody<{ password: string }>(request)
  console.log("[v0] parsed:", parsed.success, parsed.success ? "has data" : parsed.error)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { password } = parsed.data

  if (!password) return ApiResponse.badRequest("Password is required.")

  // Get user and verify password
  console.log("[v0] querying user", session.userId)
  const { rows } = await pool.query(
    "SELECT password_hash, totp_enabled, two_factor_method, email FROM users WHERE id = $1",
    [session.userId],
  )
  console.log("[v0] user found:", rows.length)
  if (rows.length === 0) return ApiResponse.notFound("User not found.")

  const valid = verifyPassword(password, rows[0].password_hash)
  if (!valid) return ApiResponse.forbidden("Incorrect password.")

  // Cannot enable if app 2FA is already active
  if (rows[0].totp_enabled && rows[0].two_factor_method === "app") {
    return ApiResponse.badRequest("Disable authenticator app 2FA first.")
  }

  // Enable email 2FA
  await pool.query(
    "UPDATE users SET totp_enabled = true, two_factor_method = 'email' WHERE id = $1",
    [session.userId],
  )

  // Send notification email about 2FA being enabled
  const ip = await getClientIp()
  const ua = await getUserAgent()
  const emailContent = email2FAEnabledEmail({
    ipAddress: ip || "Unknown",
    userAgent: ua || "Unknown",
  })

  // Send notification in background - don't block the response
  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: rows[0].email,
      type: "two_factor_changes",
      emailContent,
    }).catch((err) => console.error("Failed to send email 2FA enabled notification:", err))
  })

  return ApiResponse.success({ success: true })
})

// DELETE - Disable email 2FA
export const DELETE = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const parsed = await parseBody<{ password: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { password } = parsed.data

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

  // Clean up any pending email codes
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [session.userId])

  // Send notification email about 2FA being disabled
  const ip = await getClientIp()
  const ua = await getUserAgent()
  const emailContent = email2FADisabledEmail({
    ipAddress: ip || "Unknown",
    userAgent: ua || "Unknown",
  })

  // Send notification in background - don't block the response
  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: rows[0].email,
      type: "two_factor_changes",
      emailContent,
    }).catch((err) => console.error("Failed to send email 2FA disabled notification:", err))
  })

  return ApiResponse.success({ success: true })
})
