import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { revokeApiKey } from "@/lib/api-keys"

export async function POST(
  _request: NextRequest,
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

  const revoked = await revokeApiKey(keyId, session.userId)
  if (!revoked) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
