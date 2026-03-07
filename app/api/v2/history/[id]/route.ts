import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES } from "@/lib/constants"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  const { id } = await params

  // First, get the scan and its owner
  const scanResult = await pool.query(
    `SELECT id, url, summary, findings, findings_count, duration, scanned_at, user_id, response_headers, notes
     FROM scan_history
     WHERE id = $1`,
    [id],
  )

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  const scan = scanResult.rows[0]

  // Allow if it's the user's own scan
  if (scan.user_id === session.userId) {
    return NextResponse.json({
      url: scan.url,
      scannedAt: scan.scanned_at,
      duration: scan.duration,
      summary: scan.summary,
      findings: scan.findings || [],
      responseHeaders: scan.response_headers || undefined,
      notes: scan.notes || "",
      userId: scan.user_id,
    })
  }

  // Check if both users are members of the same team
  const teamCheck = await pool.query(
    `SELECT COUNT(*) as team_count
     FROM team_members tm1
     JOIN team_members tm2 ON tm1.team_id = tm2.team_id
     WHERE tm1.user_id = $1 AND tm2.user_id = $2`,
    [session.userId, scan.user_id],
  )

  if (teamCheck.rows[0].team_count > 0) {
    // They're on the same team, allow access but don't show delete option
    return NextResponse.json({
      url: scan.url,
      scannedAt: scan.scanned_at,
      duration: scan.duration,
      summary: scan.summary,
      findings: scan.findings || [],
      responseHeaders: scan.response_headers || undefined,
      notes: scan.notes || "",
      userId: scan.user_id,
    })
  }

  // Not authorized to view this scan
  return NextResponse.json({ error: "Scan not found" }, { status: 404 })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json()
  const { notes } = body

  if (typeof notes !== "string") {
    return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
  }

  // Only allow the scan owner to update notes
  const result = await pool.query(
    `UPDATE scan_history SET notes = $1 WHERE id = $2 AND user_id = $3 RETURNING id, notes`,
    [notes.slice(0, 2000), id, session.userId],
  )

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  return NextResponse.json({ notes: result.rows[0].notes })
}
