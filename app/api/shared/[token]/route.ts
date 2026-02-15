import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!token || token.length !== 64) {
    return NextResponse.json({ error: "Invalid share link" }, { status: 400 })
  }

  const result = await pool.query(
    `SELECT sh.url, sh.summary, sh.findings, sh.findings_count, sh.duration, sh.scanned_at, sh.response_headers, u.name as scanned_by, u.avatar_url as scanned_by_avatar
     FROM scan_history sh
     JOIN users u ON sh.user_id = u.id
     WHERE sh.share_token = $1`,
    [token],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Shared scan not found or link has been revoked" }, { status: 404 })
  }

  const row = result.rows[0]

  return NextResponse.json({
    url: row.url,
    scannedAt: row.scanned_at,
    duration: row.duration,
    summary: row.summary,
    findings: row.findings || [],
    responseHeaders: row.response_headers || undefined,
    scannedBy: row.scanned_by || "Anonymous",
    scannedByAvatar: row.scanned_by_avatar || null,
  })
}
