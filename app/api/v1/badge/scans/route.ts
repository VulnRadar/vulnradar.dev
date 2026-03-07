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
    `SELECT id, url, share_token, findings_count, scanned_at, summary, findings
     FROM scan_history
     WHERE user_id = $1
     ORDER BY scanned_at DESC
     LIMIT 50`,
    [session.userId],
  )

  const scans = result.rows.map((row) => ({
    id: row.id,
    url: row.url,
    share_token: row.share_token,
    findings_count: row.findings_count,
    scanned_at: row.scanned_at,
    summary: typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary,
    findings: typeof row.findings === "string" ? JSON.parse(row.findings) : (row.findings || []),
  }))

  return NextResponse.json(scans)
}
