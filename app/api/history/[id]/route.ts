import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const result = await pool.query(
    `SELECT id, url, summary, findings, findings_count, duration, scanned_at
     FROM scan_history
     WHERE id = $1 AND user_id = $2`,
    [id, session.userId],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  const row = result.rows[0]

  return NextResponse.json({
    url: row.url,
    scannedAt: row.scanned_at,
    duration: row.duration,
    summary: row.summary,
    findings: row.findings || [],
  })
}
