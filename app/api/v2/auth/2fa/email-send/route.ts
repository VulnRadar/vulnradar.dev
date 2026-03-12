import { NextRequest } from "next/server"
import { randomInt } from "node:crypto"
import pool from "@/lib/db"
import { email2FACodeEmail, sendEmail } from "@/lib/email"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { AUTH_2FA_PENDING_COOKIE } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  // Validate the pending 2FA cookie (check both normal login and Discord login)
  const pending = request.cookies.get(AUTH_2FA_PENDING_COOKIE)?.value
  const discordPending = request.cookies.get("discord_pending_login")?.value
  
  let userId: number | null = null
  
  if (discordPending) {
    try {
      const parsed = JSON.parse(discordPending)
      if (parsed && parsed.userId) {
        userId = parsed.userId
        // Check if Discord pending token is expired (5 minutes)
        if (Date.now() - parsed.ts > 5 * 60 * 1000) {
          return ApiResponse.unauthorized("Discord login session expired. Please try again.")
        }
      }
    } catch {
      // Invalid JSON, check regular pending
    }
  }
  
  if (!userId && pending) {
    userId = parseInt(pending, 10)
    if (isNaN(userId)) userId = null
  }
  
  if (!userId) {
    return ApiResponse.unauthorized("No pending 2FA session.")
  }

  // Get user email
  const userResult = await pool.query("SELECT email FROM users WHERE id = $1", [userId])
  const user = userResult.rows[0]
  if (!user) return ApiResponse.badRequest("User not found.")

  // Check if a code was recently sent (rate limit: 1 per 60 seconds)
  const recentCode = await pool.query(
    "SELECT created_at FROM email_2fa_codes WHERE user_id = $1 AND created_at > NOW() - INTERVAL '60 seconds' ORDER BY created_at DESC LIMIT 1",
    [userId],
  )
  if (recentCode.rows.length > 0) {
    return ApiResponse.tooManyRequests("Please wait before requesting another code.", 60)
  }

  // Delete old codes for this user
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [userId])

  // Generate 6-digit code
  const code = randomInt(100000, 999999).toString()

  // Store hashed code with 10 min expiry
  await pool.query(
    "INSERT INTO email_2fa_codes (user_id, code_hash, expires_at) VALUES ($1, encode(sha256($2::bytea), 'hex'), NOW() + INTERVAL '10 minutes')",
    [userId, code],
  )

  // Send the email
  const emailContent = email2FACodeEmail(code)
  await sendEmail({
    to: user.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  })

  // Mask email for UI
  const parts = user.email.split("@")
  const masked = parts[0].substring(0, 2) + "***@" + parts[1]

  return ApiResponse.success({ message: "Code sent.", maskedEmail: masked })
})
