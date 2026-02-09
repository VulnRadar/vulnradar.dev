import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: "Invite token required." }, { status: 400 })

  // Find valid invite
  const inviteRes = await pool.query(
    `SELECT ti.id, ti.team_id, ti.email, ti.role, ti.expires_at, t.name as team_name
     FROM team_invites ti JOIN teams t ON t.id = ti.team_id
     WHERE ti.token = $1 AND ti.accepted_at IS NULL`,
    [token],
  )

  if (inviteRes.rows.length === 0) {
    return NextResponse.json({ error: "Invalid or already used invite." }, { status: 400 })
  }

  const invite = inviteRes.rows[0]

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: "This invite has expired." }, { status: 400 })
  }

  // Get user's email
  const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [session.userId])
  const userEmail = userRes.rows[0]?.email

  if (userEmail !== invite.email) {
    return NextResponse.json({ error: "This invite was sent to a different email address." }, { status: 403 })
  }

  // Check if already a member
  const existingMember = await pool.query(
    "SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2",
    [invite.team_id, session.userId],
  )
  if (existingMember.rows.length > 0) {
    return NextResponse.json({ error: "You are already a member of this team." }, { status: 400 })
  }

  // Accept invite
  await pool.query("UPDATE team_invites SET accepted_at = NOW() WHERE id = $1", [invite.id])
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
    [invite.team_id, session.userId, invite.role],
  )

  return NextResponse.json({ message: `You joined ${invite.team_name}!`, teamId: invite.team_id })
}
