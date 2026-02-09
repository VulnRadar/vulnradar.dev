import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { sendEmail, teamInviteEmail } from "@/lib/email"

// Get team members
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get("teamId")
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 })

  // Verify membership
  const memberCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )
  if (memberCheck.rows.length === 0) {
    return NextResponse.json({ error: "Not a team member." }, { status: 403 })
  }

  const members = await pool.query(
    `SELECT tm.user_id, tm.role, tm.joined_at, u.name, u.email
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1 ORDER BY tm.role, u.name`,
    [teamId],
  )

  const invites = await pool.query(
    `SELECT id, email, role, created_at, expires_at FROM team_invites
     WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [teamId],
  )

  return NextResponse.json({
    members: members.rows,
    invites: invites.rows,
    currentRole: memberCheck.rows[0].role,
  })
}

// Invite a member
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { teamId, email, role = "viewer" } = await request.json()
  if (!teamId || !email) return NextResponse.json({ error: "teamId and email required." }, { status: 400 })
  if (!["admin", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role. Use 'admin' or 'viewer'." }, { status: 400 })
  }

  // Must be owner or admin
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )
  if (memberRes.rows.length === 0 || memberRes.rows[0].role === "viewer") {
    return NextResponse.json({ error: "Only owners/admins can invite members." }, { status: 403 })
  }

  // Check if already a member
  const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email.trim().toLowerCase()])
  if (existingUser.rows.length > 0) {
    const existingMember = await pool.query(
      "SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, existingUser.rows[0].id],
    )
    if (existingMember.rows.length > 0) {
      return NextResponse.json({ error: "User is already a team member." }, { status: 400 })
    }
  }

  // Check for existing pending invite
  const existingInvite = await pool.query(
    "SELECT id FROM team_invites WHERE team_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()",
    [teamId, email.trim().toLowerCase()],
  )
  if (existingInvite.rows.length > 0) {
    return NextResponse.json({ error: "An invite is already pending for this email." }, { status: 400 })
  }

  const token = require("crypto").randomBytes(32).toString("hex")
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  await pool.query(
    `INSERT INTO team_invites (team_id, email, role, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [teamId, email.trim().toLowerCase(), role, session.userId, token, expiresAt],
  )

  // Get team name and inviter name for email
  const teamInfo = await pool.query("SELECT name FROM teams WHERE id = $1", [teamId])
  const inviterInfo = await pool.query("SELECT name FROM users WHERE id = $1", [session.userId])

  if (teamInfo.rows.length > 0 && inviterInfo.rows.length > 0) {
    const teamName = teamInfo.rows[0].name
    const invitedBy = inviterInfo.rows[0].name
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vulnradar.dev"
    const inviteLink = `${baseUrl}/teams/join?token=${token}`
    const emailPayload = teamInviteEmail(teamName, inviteLink, invitedBy)

    // Send email in background
    queueMicrotask(() => {
      sendEmail({ to: email.trim().toLowerCase(), ...emailPayload }).catch((err) => {
        console.error("Team invite email failed:", err)
      })
    })
  }

  return NextResponse.json({ message: "Invite sent.", token })
}

// Remove a member
export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { teamId, userId, inviteId } = await request.json()

  // Handle cancel invite
  if (inviteId) {
    const memberRes = await pool.query(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, session.userId],
    )
    if (memberRes.rows.length === 0 || memberRes.rows[0].role === "viewer") {
      return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 })
    }
    await pool.query("DELETE FROM team_invites WHERE id = $1 AND team_id = $2", [inviteId, teamId])
    return NextResponse.json({ success: true })
  }

  if (!teamId || !userId) return NextResponse.json({ error: "teamId and userId required." }, { status: 400 })

  // Can't remove yourself unless you're the owner leaving
  const myRole = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )
  if (myRole.rows.length === 0) return NextResponse.json({ error: "Not a member." }, { status: 403 })

  if (userId === session.userId) {
    // Leaving the team (owners can't leave)
    if (myRole.rows[0].role === "owner") {
      return NextResponse.json({ error: "Owners cannot leave. Transfer ownership or delete the team." }, { status: 400 })
    }
    await pool.query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, userId])
    return NextResponse.json({ success: true })
  }

  // Only owner/admin can remove others
  if (myRole.rows[0].role === "viewer") {
    return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 })
  }

  // Can't remove owner
  const targetRole = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  )
  if (targetRole.rows.length > 0 && targetRole.rows[0].role === "owner") {
    return NextResponse.json({ error: "Cannot remove the team owner." }, { status: 400 })
  }

  await pool.query("DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, userId])
  return NextResponse.json({ success: true })
}
