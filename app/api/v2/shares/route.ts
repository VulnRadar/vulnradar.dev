import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function GET(_request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get all shared scans for the current user (where share_token is NOT NULL)
  const result = await pool.query(
    `SELECT 
       id,
       url,
       scanned_at,
       share_token,
       summary,
       findings
     FROM scan_history
     WHERE user_id = $1 AND share_token IS NOT NULL
     ORDER BY scanned_at DESC`,
    [session.userId],
  )

  const shares = result.rows.map((row) => {
    const findings = typeof row.findings === "string" ? JSON.parse(row.findings) : (row.findings || [])
    const summary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary
    return {
      id: row.id,
      url: row.url,
      scannedAt: row.scanned_at,
      token: row.share_token,
      summary,
      findings,
      findingsCount: findings.length,
    }
  })

  return NextResponse.json({ shares })
}
