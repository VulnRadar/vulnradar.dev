import { NextRequest } from "next/server"
import crypto from "crypto"
import { getSession } from "@/lib/auth"
import { generateSecret, verifyTOTP, generateOtpAuthUri } from "@/lib/totp"
import { twoFactorEnabledEmail } from "@/lib/email"
import { sendNotificationEmail } from "@/lib/notifications"
import pool from "@/lib/db"
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api-utils"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants"

function generateBackupCodes(count = 8): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase()
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`)
  }
  return codes
}

// GET: Generate a new secret and return the URI for QR code
export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const secret = generateSecret()
  const uri = generateOtpAuthUri(secret, session.email)

  // Store the secret temporarily (not enabled yet until they verify)
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [secret, session.userId])

  return ApiResponse.success({ secret, uri })
})

// POST: Verify the code and enable 2FA
export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)

  const parsed = await parseBody<{ code: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { code } = parsed.data

  if (!code || typeof code !== "string" || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return ApiResponse.badRequest("Valid 6-digit code required")
  }

  // Get the stored secret
  const result = await pool.query("SELECT totp_secret FROM users WHERE id = $1", [session.userId])
  const secret = result.rows[0]?.totp_secret
  if (!secret) {
    return ApiResponse.badRequest("No 2FA setup in progress. Start setup first.")
  }

  // Verify the code
  if (!verifyTOTP(secret, code)) {
    return ApiResponse.badRequest("Invalid code. Check your authenticator app and try again.")
  }

  // Generate backup codes and enable 2FA
  const backupCodes = generateBackupCodes(8)
  await pool.query(
    "UPDATE users SET totp_enabled = true, backup_codes = $1 WHERE id = $2",
    [JSON.stringify(backupCodes), session.userId],
  )

  // Send security notification email (don't await)
  const ip = await getClientIp()
  const userAgent = await getUserAgent()

  const emailContent = twoFactorEnabledEmail({ ipAddress: ip, userAgent })
  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "security",
    emailContent,
  }).catch((err) => console.error("[Email Error] Failed to send 2FA enabled notification:", err))

  return ApiResponse.success({ message: SUCCESS_MESSAGES.TWO_FA_ENABLED, backupCodes })
})
