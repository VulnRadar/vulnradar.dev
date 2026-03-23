import { NextResponse, NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import { rotateApiKey, getUserApiKeys } from "@/lib/api-keys"
import { sendNotificationEmail } from "@/lib/notifications"
import { apiKeyCreatedEmail } from "@/lib/email"
import { ERROR_MESSAGES } from "@/lib/constants"
import { getClientIp, getUserAgent } from "@/lib/request-utils"
import { getApiLimitForPlan } from "@/lib/plans"
import pool from "@/lib/db"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  const { id } = await params
  const keyId = parseInt(id, 10)
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 })
  }

  // Get key details before rotating
  const keys = await getUserApiKeys(session.userId)
  const keyToRotate = keys.find((k: { id: number; revoked_at: string | null }) => k.id === keyId && !k.revoked_at)

  if (!keyToRotate) {
    return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 })
  }

  // Get user's plan to set the correct daily limit
  const userResult = await pool.query(
    "SELECT plan FROM users WHERE id = $1",
    [session.userId]
  )
  const userPlan = userResult.rows[0]?.plan || "free"
  const dailyLimit = getApiLimitForPlan(userPlan)

  // Rotate the key
  const newKey = await rotateApiKey(keyId, session.userId, dailyLimit === -1 ? 999999 : dailyLimit)
  if (!newKey) {
    return NextResponse.json({ error: "Failed to rotate key" }, { status: 500 })
  }

  // Send notification email
  const ip = await getClientIp() || "Unknown"
  const userAgent = await getUserAgent() || "Unknown"
  const emailContent = apiKeyCreatedEmail(newKey.name, newKey.key_prefix, { ipAddress: ip, userAgent })

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "api_keys",
    emailContent,
  }).catch((err) => console.error("Failed to send API key rotated notification:", err))

  return NextResponse.json({ 
    success: true, 
    key: {
      id: newKey.id,
      key_prefix: newKey.key_prefix,
      name: newKey.name,
      daily_limit: newKey.daily_limit,
      created_at: newKey.created_at,
      raw_key: newKey.raw_key,
    }
  })
}
