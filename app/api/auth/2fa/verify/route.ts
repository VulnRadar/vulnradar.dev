import { NextRequest, NextResponse } from "next/server"
import { createSession, verifyPassword } from "@/lib/auth"
import { verifyTOTP } from "@/lib/totp"
import pool from "@/lib/db"
import { ApiResponse, parseBody, Validate, withErrorHandling } from "@/lib/api-utils"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import {
  AUTH_2FA_PENDING_COOKIE,
  AUTH_2FA_PENDING_MAX_AGE,
  DEVICE_TRUST_COOKIE_NAME,
  DEVICE_TRUST_MAX_AGE,
  ERROR_MESSAGES,
} from "@/lib/constants"

export const POST = withErrorHandling(async (request: NextRequest) => {
  const ip = await getClientIp()
  const userAgent = await getUserAgent()

  const parsed = await parseBody<{
    userId: number
    code?: string
    backupCode?: string
    rememberDevice?: boolean
  }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const { userId, code, backupCode, rememberDevice } = parsed.data

  const validationError = Validate.multiple([
    Validate.required(userId, "User ID"),
    Validate.required(code || backupCode, "Code or backup code"),
  ])
  if (validationError) return ApiResponse.badRequest(validationError)

  // Verify the pending 2FA token
  const pending = request.cookies.get(AUTH_2FA_PENDING_COOKIE)?.value
  if (!pending || pending !== String(userId)) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.INVALID_2FA_SESSION)
  }

  // Get user's TOTP secret and backup codes
  const result = await pool.query(
    "SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = $1",
    [userId],
  )
  const user = result.rows[0]
  if (!user || !user.totp_enabled || !user.totp_secret) {
    return ApiResponse.badRequest("2FA is not enabled for this account.")
  }

  let verified = false

  if (backupCode) {
    // Verify backup code against hashed codes
    const normalizedInput = backupCode.trim().toUpperCase().replace(/[\s-]/g, "")
    const storedHashes: string[] = user.backup_codes ? JSON.parse(user.backup_codes) : []
    const matchIndex = storedHashes.findIndex((hash: string) => {
      try {
        return verifyPassword(normalizedInput, hash)
      } catch {
        return false
      }
    })
    if (matchIndex >= 0) {
      verified = true
      // Consume the backup code (one-time use)
      storedHashes.splice(matchIndex, 1)
      await pool.query("UPDATE users SET backup_codes = $1 WHERE id = $2", [
        JSON.stringify(storedHashes),
        userId,
      ])
    }
  } else if (code) {
    // Verify TOTP code
    const codeError = Validate.multiple([
      Validate.required(code, "Code"),
      Validate.string(code, "Code", 6, 6),
      Validate.pattern(code, "Code", /^\d{6}$/, "Must be 6 digits"),
    ])
    if (codeError) return ApiResponse.badRequest(codeError)

    verified = verifyTOTP(user.totp_secret, code)
  }

  if (!verified) {
    return ApiResponse.badRequest("Invalid code. Please try again.")
  }

  // Create session with IP and user agent
  await createSession(userId, ip, userAgent)

  // Create response
  const response = NextResponse.json({ success: true })

  // Clear the pending cookie
  response.cookies.delete(AUTH_2FA_PENDING_COOKIE)

  // If user wants to remember this device, set device trust cookie
  if (rememberDevice === true) {
    const deviceId = `${ip}-${userAgent}`.split("").reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0)
    response.cookies.set(DEVICE_TRUST_COOKIE_NAME, String(deviceId), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_TRUST_MAX_AGE,
    })
  }

  return response
})
