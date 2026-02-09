import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import crypto from "crypto"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  // Get the scan
  const existing = await pool.query(
    "SELECT id, share_token, user_id FROM scan_history WHERE id = $1",
    [id],
  )

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  const scan = existing.rows[0]

  // Check if user owns the scan OR is a team member with the scan owner
  if (scan.user_id !== session.userId) {
    const teamCheck = await pool.query(
      `SELECT COUNT(*) as team_count
       FROM team_members tm1
       JOIN team_members tm2 ON tm1.team_id = tm2.team_id
       WHERE tm1.user_id = $1 AND tm2.user_id = $2`,
      [session.userId, scan.user_id],
    )

    if (teamCheck.rows[0].team_count === 0) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 })
    }
  }

  // If already has a share token, return it
  if (scan.share_token) {
    return NextResponse.json({ token: scan.share_token })
  }

  // Generate a new share token
  const token = crypto.randomBytes(32).toString("hex")

  await pool.query(
    "UPDATE scan_history SET share_token = $1 WHERE id = $2",
    [token, id],
  )

  return NextResponse.json({ token })
}

// DELETE to revoke sharing
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  // Get the scan to check ownership
  const scan = await pool.query(
    "SELECT user_id FROM scan_history WHERE id = $1",
    [id],
  )

  if (scan.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 })
  }

  // Check if user owns the scan OR is a team member
  if (scan.rows[0].user_id !== session.userId) {
    const teamCheck = await pool.query(
      `SELECT COUNT(*) as team_count
       FROM team_members tm1
       JOIN team_members tm2 ON tm1.team_id = tm2.team_id
       WHERE tm1.user_id = $1 AND tm2.user_id = $2`,
      [session.userId, scan.rows[0].user_id],
    )

    if (teamCheck.rows[0].team_count === 0) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 })
    }
  }

  await pool.query(
    "UPDATE scan_history SET share_token = NULL WHERE id = $1",
    [id],
  )

  return NextResponse.json({ success: true })
}
