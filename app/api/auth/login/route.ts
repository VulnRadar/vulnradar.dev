import { NextResponse } from "next/server"
import { getUserByEmail, verifyPassword, createSession } from "@/lib/auth"
import pool from "@/lib/db"
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { ApiResponse, Validate, parseBody, withErrorHandling } from "@/lib/api-utils"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { AUTH_2FA_PENDING_COOKIE, AUTH_2FA_PENDING_MAX_AGE, DEVICE_TRUST_COOKIE_NAME, ERROR_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async (request: Request) => {
  // Parse body
  const parsed = await parseBody<{ email: string; password: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { email, password } = parsed.data

  // Validate input
  const error = Validate.multiple([
    Validate.required(email, "Email"),
    Validate.email(email),
    Validate.required(password, "Password"),
  ])
  if (error) return ApiResponse.badRequest(error)

  // Rate limit by IP
  const ip = await getClientIp()
  const rl = await checkRateLimit({ key: `login:${ip}`, ...RATE_LIMITS.login })
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60)
    return ApiResponse.tooManyRequests(
      `Too many login attempts. Try again in ${minutes} minute(s).`,
      rl.retryAfterSeconds,
    )
  }

  const user = await getUserByEmail(email)
  if (!user) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS)
  }

  const valid = verifyPassword(password, user.password_hash)
  if (!valid) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_CREDENTIALS)
  }

  // Check if account is disabled or email not verified
  const userInfoResult = await pool.query(
    "SELECT totp_enabled, disabled_at, email_verified_at FROM users WHERE id = $1",
    [user.id],
  )
  const userInfo = userInfoResult.rows[0]
  if (userInfo?.disabled_at) {
    return ApiResponse.forbidden("This account has been suspended. Please contact support.")
  }

  // Check if email is verified
  if (!userInfo?.email_verified_at) {
    return ApiResponse.forbidden("Please verify your email before logging in.", {
      unverified: true,
    })
  }

  // Check if 2FA is enabled
  const has2FA = userInfo?.totp_enabled === true

  if (has2FA) {
    // Check if device is trusted (skip 2FA for trusted devices)
    const userAgent = await getUserAgent()
    const deviceId = `${ip}-${userAgent}`.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)
    const deviceCookie = (request as any).cookies?.get?.(DEVICE_TRUST_COOKIE_NAME)?.value
    
    if (deviceCookie && deviceCookie === String(deviceId)) {
      // Device is trusted - create session directly without 2FA
      await createSession(user.id, ip, userAgent)
      return ApiResponse.success({
        user: { id: user.id, email: user.email, name: user.name },
      })
    }

    // Device is not trusted - require 2FA
    const response = NextResponse.json({
      requires2FA: true,
      userId: user.id,
    })
    // Set a short-lived cookie to validate the 2FA verification request
    response.cookies.set(AUTH_2FA_PENDING_COOKIE, String(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_2FA_PENDING_MAX_AGE, // seconds
    })
    return response
  }

  // No 2FA -- create session directly
  const ua = await getUserAgent()
  await createSession(user.id, ip, ua)

  return ApiResponse.success({
    user: { id: user.id, email: user.email, name: user.name },
  })
})
