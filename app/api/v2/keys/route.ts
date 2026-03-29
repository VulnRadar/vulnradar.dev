import { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import { generateApiKey, getUserApiKeys } from "@/lib/api/api-keys"
import { sendNotificationEmail } from "@/lib/notifications/notifications"
import { apiKeyCreatedEmail } from "@/lib/email/email"
import { ApiResponse, parseBody, Validate, withErrorHandling } from "@/lib/api/api-utils"
import { getClientIp, getUserAgent } from "@/lib/api/request-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/config/constants"
import { getApiLimitForPlan } from "@/lib/billing/plans"
import pool from "@/lib/database/db"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const keys = await getUserApiKeys(session.userId)
  return ApiResponse.success({ keys })
})

export const POST = withErrorHandling(async (request: NextRequest) => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const parsed = await parseBody<{ name?: string }>(request)
  if (!parsed.success) return ApiResponse.badRequest(parsed.error)
  const name = (parsed.data.name?.trim() || "Default").slice(0, 100)

  const nameError = Validate.string(name, "Key name", 1, 100)
  if (nameError) return ApiResponse.badRequest(nameError)

  // Limit to 3 active keys per user
  const existing = await getUserApiKeys(session.userId)
  const activeKeys = existing.filter((k: { revoked_at: string | null }) => !k.revoked_at)
  if (activeKeys.length >= 3) {
    return ApiResponse.badRequest("Maximum of 3 active API keys allowed. Rotate an existing key instead.")
  }

  // Get user's plan to set the correct daily limit
  const userResult = await pool.query(
    "SELECT plan FROM users WHERE id = $1",
    [session.userId]
  )
  const userPlan = userResult.rows[0]?.plan || "free"
  const dailyLimit = getApiLimitForPlan(userPlan)

  const key = await generateApiKey(session.userId, name, dailyLimit === -1 ? 999999 : dailyLimit)

  // Send notification email in background
  const ip = await getClientIp()
  const userAgent = await getUserAgent()
  const emailContent = apiKeyCreatedEmail(name, key.key_prefix, { ipAddress: ip, userAgent })

  setImmediate(() => {
    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "api_keys",
      emailContent,
    }).catch((err) => console.error("[Email Error] Failed to send API key created notification:", err))
  })

  return ApiResponse.success({ key }, 201)
})
