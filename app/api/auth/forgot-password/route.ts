import { NextRequest } from "next/server"
import pool from "@/lib/db"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/request-utils"
import { PASSWORD_RESET_TOKEN_LIFETIME, ERROR_MESSAGES } from "@/lib/constants"
import crypto from "crypto"
import { sendEmail, passwordResetEmail } from "@/lib/email"
import { ApiResponse, parseBody, withErrorHandling, Validate } from "@/lib/api-utils"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp()
  const rl = await checkRateLimit({ key: `forgot:${ip}`, ...RATE_LIMITS.forgotPassword })
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60)
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS("reset attempts", minutes),
      rl.retryAfterSeconds,
    )
  }

  const parsed = await parseBody<{ email: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { email } = parsed.data

  const emailError = Validate.email(email)
  if (emailError) return ApiResponse.badRequest(emailError)

  const normalizedEmail = email.trim().toLowerCase()

  // Always return success to prevent email enumeration
  const successMsg = { message: "If an account with that email exists, a reset link has been generated." }

  const userRes = await pool.query("SELECT id, totp_enabled FROM users WHERE email = $1", [normalizedEmail])
  if (userRes.rows.length === 0) {
    return ApiResponse.success(successMsg)
  }

  const user = userRes.rows[0]

  // Delete any existing tokens for this user
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [user.id])

  // Generate a secure token
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_LIFETIME * 1000)

  await pool.query(
    "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.id, token, expiresAt],
  )

  // Send reset email via SMTP in the background
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vulnradar.dev"
  const resetLink = `${baseUrl}/reset-password?token=${token}`
  const emailPayload = passwordResetEmail(resetLink)

  queueMicrotask(() => {
    sendEmail({ to: normalizedEmail, ...emailPayload }).catch((err) => {
      console.error("[Email Error] Password reset email failed:", err)
    })
  })

  return ApiResponse.success(successMsg)
})
