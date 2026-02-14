import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!token || token.length !== 64) {
    return NextResponse.json({ error: "Invalid share token" }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT sh.url, sh.summary, sh.findings_count, sh.scanned_at
     FROM scan_history sh
     WHERE sh.share_token = $1`,
    [token],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const row = result.rows[0]
  const summary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary
  const critical = summary?.critical || 0
  const high = summary?.high || 0

  let safetyRating: string
  if (critical > 0 || high >= 2) {
    safetyRating = "unsafe"
  } else if (high === 1 || (summary?.medium || 0) >= 3) {
    safetyRating = "caution"
  } else {
    safetyRating = "safe"
  }

  const origin = request.nextUrl.origin

  return NextResponse.json({
    safetyRating,
    issuesCount: row.findings_count,
    lastScanned: row.scanned_at,
    url: row.url,
    shareUrl: `${origin}/shared/${token}`,
    badgeUrl: `${origin}/api/badge/${token}`,
  }, {
    headers: {
      "Cache-Control": "public, max-age=3600",
    },
  })
}
