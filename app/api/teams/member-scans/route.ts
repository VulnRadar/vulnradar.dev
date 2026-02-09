import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

// Get a team member's scan history
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get("teamId")
  const userId = searchParams.get("userId")

  if (!teamId || !userId) {
    return NextResponse.json({ error: "teamId and userId required." }, { status: 400 })
  }

  // Verify the requester is a team member
  const requesterCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )

  if (requesterCheck.rows.length === 0) {
    return NextResponse.json({ error: "Not a team member." }, { status: 403 })
  }

  // Verify the target user is also a team member
  const targetCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  )

  if (targetCheck.rows.length === 0) {
    return NextResponse.json({ error: "User is not a team member." }, { status: 404 })
  }

  // Fetch the team member's scan history
  const scans = await pool.query(
    `SELECT id, url, findings_count, duration, scanned_at
     FROM scan_history
     WHERE user_id = $1
     ORDER BY scanned_at DESC
     LIMIT 50`,
    [userId],
  )

  return NextResponse.json({ scans: scans.rows })
}

