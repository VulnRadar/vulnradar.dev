import { NextRequest, NextResponse } from "next/server"
import { createUser, getUserByEmail } from "@/lib/auth"
import { sendEmail, emailVerificationEmail } from "@/lib/email"
import { ApiResponse, Validate, parseBody, withErrorHandling } from "@/lib/api-utils"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/request-utils"
import pool from "@/lib/db"
import crypto from "crypto"
import { APP_URL, ERROR_MESSAGES, SUCCESS_MESSAGES, EMAIL_VERIFICATION_TOKEN_LIFETIME, PATTERNS } from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const parsed = await parseBody<{ email: string; password: string; name: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { email, password, name } = parsed.data

  // Validate input using centralized validators
  const validationError = Validate.multiple([
    Validate.required(name, "Name"),
    Validate.string(name, "Name", 1, 255),
    Validate.required(email, "Email"),
    Validate.email(email),
    Validate.required(password, "Password"),
    Validate.password(password, 8), // Using 8 char minimum
  ])
  if (validationError) return ApiResponse.badRequest(validationError)

  // Rate limit by IP
  const ip = await getClientIp()
  const rl = await checkRateLimit({ key: `signup:${ip}`, ...RATE_LIMITS.signup })
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60)
    return ApiResponse.tooManyRequests(
      ERROR_MESSAGES.TOO_MANY_ATTEMPTS("signup attempts", minutes),
      rl.retryAfterSeconds,
    )
  }

  // Check if user already exists
  const existing = await getUserByEmail(email)
  if (existing) {
    return ApiResponse.conflict(ERROR_MESSAGES.DUPLICATE_EMAIL)
  }

  // Create user
  const user = await createUser(email, password, name)

  // Generate verification token
  const token = crypto.randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TOKEN_LIFETIME * 1000)

  // Delete any existing verification tokens for this user
  await pool.query("DELETE FROM email_verification_tokens WHERE user_id = $1", [user.id])

  // Store token
  await pool.query(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.id, token, expiresAt]
  )

  // Create default notification preferences for the user
  await pool.query(
    `INSERT INTO notification_preferences (user_id, email_api_keys, email_webhooks, email_schedules, email_data_requests, email_security)
     VALUES ($1, true, true, true, true, true)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  )

  // Send verification email in background (don't block the response)
  const verifyLink = `${APP_URL}/verify-email?token=${token}`
  const emailContent = emailVerificationEmail(name.trim(), verifyLink)

  setImmediate(() => {
    sendEmail({
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    }).catch((err) => {
      console.error("[Email Error] Failed to send verification email:", err)
    })
  })

  return ApiResponse.success({
    message: SUCCESS_MESSAGES.SIGNUP,
    requiresVerification: true,
  })
})
