import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { generateApiKey, getUserApiKeys } from "@/lib/api-keys"

// GET /api/keys - list user's API keys
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const keys = await getUserApiKeys(session.userId)
  return NextResponse.json({ keys })
}

// POST /api/keys - generate a new API key
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const name = body.name?.trim() || "Default"

  if (name.length > 100) {
    return NextResponse.json(
      { error: "Key name must be 100 characters or less." },
      { status: 400 },
    )
  }

  // Limit to 3 active keys per user
  const existing = await getUserApiKeys(session.userId)
  const activeKeys = existing.filter((k: { revoked_at: string | null }) => !k.revoked_at)
  if (activeKeys.length >= 3) {
    return NextResponse.json(
      { error: "Maximum of 3 active API keys allowed. Revoke an existing key first." },
      { status: 400 },
    )
  }

  const key = await generateApiKey(session.userId, name)
  return NextResponse.json({ key })
}
