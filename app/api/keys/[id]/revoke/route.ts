import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { revokeApiKey, getUserApiKeys } from "@/lib/api-keys"
import { sendNotificationEmail } from "@/lib/notifications"
import { apiKeyDeletedEmail } from "@/lib/email"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const keyId = parseInt(id, 10)
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 })
  }

  // Get key details before revoking for the email
  const keys = await getUserApiKeys(session.userId)
  const keyToRevoke = keys.find((k: { id: number }) => k.id === keyId)

  const revoked = await revokeApiKey(keyId, session.userId)
  if (!revoked) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 })
  }

  // Send notification email
  if (keyToRevoke) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "Unknown"
    const userAgent = request.headers.get("user-agent") || "Unknown"
    const emailContent = apiKeyDeletedEmail(keyToRevoke.name, { ipAddress: ip, userAgent })

    sendNotificationEmail({
      userId: session.userId,
      userEmail: session.email,
      type: "api_keys",
      emailContent,
    }).catch((err) => console.error("Failed to send API key revoked notification:", err))
  }

  return NextResponse.json({ success: true })
}
