import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

function detectWebhookType(url: string): string {
  if (/discord\.com\/api\/webhooks/i.test(url) || /discordapp\.com\/api\/webhooks/i.test(url)) return "discord"
  if (/hooks\.slack\.com/i.test(url)) return "slack"
  return "generic"
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await pool.query(
    "SELECT id, url, name, type, active, created_at FROM webhooks WHERE user_id = $1 ORDER BY created_at DESC",
    [session.userId],
  )
  return NextResponse.json(result.rows)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { url, name, type: userType } = await request.json()
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "Webhook URL is required" }, { status: 400 })
  }

  try { new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  // Max 5 webhooks per user
  const countRes = await pool.query("SELECT COUNT(*)::int as count FROM webhooks WHERE user_id = $1", [session.userId])
  if (countRes.rows[0].count >= 5) {
    return NextResponse.json({ error: "Maximum 5 webhooks allowed" }, { status: 400 })
  }

  // Auto-detect type from URL if user didn't specify or chose "auto"
  const webhookType = (userType && userType !== "auto") ? userType : detectWebhookType(url)

  const result = await pool.query(
    "INSERT INTO webhooks (user_id, url, name, type) VALUES ($1, $2, $3, $4) RETURNING id, url, name, type, active, created_at",
    [session.userId, url, name || "Default", webhookType],
  )
  return NextResponse.json(result.rows[0], { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await request.json()
  await pool.query("DELETE FROM webhooks WHERE id = $1 AND user_id = $2", [id, session.userId])
  return NextResponse.json({ success: true })
}
