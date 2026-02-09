import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

const FREQ_INTERVALS: Record<string, string> = {
  daily: "1 day",
  weekly: "7 days",
  monthly: "30 days",
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const result = await pool.query(
    "SELECT id, url, frequency, active, last_run_at, next_run_at, created_at FROM scheduled_scans WHERE user_id = $1 ORDER BY created_at DESC",
    [session.userId],
  )
  return NextResponse.json(result.rows)
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { url, frequency } = await request.json()
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  try { new URL(url) } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  const freq = frequency && FREQ_INTERVALS[frequency] ? frequency : "weekly"
  const interval = FREQ_INTERVALS[freq]

  // Max 10 scheduled scans per user
  const countRes = await pool.query("SELECT COUNT(*)::int as count FROM scheduled_scans WHERE user_id = $1", [session.userId])
  if (countRes.rows[0].count >= 10) {
    return NextResponse.json({ error: "Maximum 10 scheduled scans allowed" }, { status: 400 })
  }

  const result = await pool.query(
    `INSERT INTO scheduled_scans (user_id, url, frequency, next_run_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '${interval}')
     RETURNING id, url, frequency, active, last_run_at, next_run_at, created_at`,
    [session.userId, url, freq],
  )
  return NextResponse.json(result.rows[0], { status: 201 })
}

export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await request.json()
  await pool.query("DELETE FROM scheduled_scans WHERE id = $1 AND user_id = $2", [id, session.userId])
  return NextResponse.json({ success: true })
}
