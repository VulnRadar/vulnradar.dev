import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Return ALL scans, not just shared ones. Include share_token if it exists.
  const result = await pool.query(
    `SELECT id, url, share_token, findings_count, scanned_at, summary
     FROM scan_history
     WHERE user_id = $1
     ORDER BY scanned_at DESC
     LIMIT 50`,
    [session.userId],
  )

  return NextResponse.json(result.rows)
}
