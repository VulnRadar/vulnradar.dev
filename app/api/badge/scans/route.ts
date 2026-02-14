import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await pool.query(
    `SELECT id, url, share_token, findings_count, scanned_at
     FROM scan_history
     WHERE user_id = $1 AND share_token IS NOT NULL
     ORDER BY scanned_at DESC
     LIMIT 50`,
    [session.userId],
  )

  return NextResponse.json(result.rows)
}
