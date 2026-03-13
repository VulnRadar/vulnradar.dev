import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"
import { getSafetyRating } from "@/lib/scanner/safety-rating"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!token || token.length !== 64) {
    return NextResponse.json({ error: "Invalid share token" }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT sh.url, sh.findings, sh.findings_count, sh.scanned_at
     FROM scan_history sh
     WHERE sh.share_token = $1`,
    [token],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const row = result.rows[0]
  const findings = typeof row.findings === "string" ? JSON.parse(row.findings) : (row.findings || [])
  const safetyRating = getSafetyRating(findings)

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
