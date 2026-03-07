import { NextRequest } from "next/server"
import pool from "@/lib/db"
import { sendEmail, emailVerificationEmail } from "@/lib/email"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/request-utils"
import crypto from "crypto"
import { ApiResponse, parseBody, Validate, withErrorHandling } from "@/lib/api-utils"
import { APP_URL, EMAIL_VERIFICATION_TOKEN_LIFETIME } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp()
  const rl = await checkRateLimit({ key: `resend-verify:${ip}`, ...RATE_LIMITS.forgotPassword })
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60)
    return ApiResponse.tooManyRequests(
      `Too many requests. Please try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    )
  }

  const parsed = await parseBody<{ email: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { email } = parsed.data

  const emailError = Validate.email(email)
  if (emailError) return ApiResponse.badRequest(emailError)

  const normalizedEmail = email.toLowerCase().trim()

  // Find user (case-insensitive)
  const userRes = await pool.query(
    "SELECT id, name, email_verified_at FROM users WHERE LOWER(email) = $1",
    [normalizedEmail]
  )

  // Don't reveal if user exists or not
  if (userRes.rows.length === 0) {
    return ApiResponse.success({
      message: "If an account exists with this email, a verification link has been sent."
    })
  }

  const user = userRes.rows[0]

  // Check if already verified
  if (user.email_verified_at) {
    return ApiResponse.success({
      message: "If an account exists with this email, a verification link has been sent."
    })
  }

  // Delete existing tokens
  await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [user.id])

  // Generate new token
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_LIFETIME * 1000)

  await pool.query(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.id, token, expiresAt]
  )

  // Send verification email in background (don't block the response)
  const verifyLink = `${APP_URL}/verify-email?token=${token}`
  const emailContent = emailVerificationEmail(user.name || "there", verifyLink)

  setImmediate(() => {
    sendEmail({
      to: normalizedEmail,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    }).catch((err) => {
      console.error("[Email Error] Failed to send verification email:", err)
    })
  })

  return ApiResponse.success({
    message: "If an account exists with this email, a verification link has been sent."
  })
})
