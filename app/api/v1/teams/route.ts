import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ERROR_MESSAGES, TEAM_ROLES } from "@/lib/constants"

// List user's teams
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const result = await pool.query(
    `SELECT t.id, t.name, t.created_at, tm.role,
       (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) as member_count
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
     ORDER BY t.name`,
    [session.userId],
  )

  return NextResponse.json({ teams: result.rows })
}

// Create a new team
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const { name } = await request.json()
  if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
    return NextResponse.json({ error: "Team name must be 2-50 characters." }, { status: 400 })
  }

  // Limit teams per user
  const countRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM team_members WHERE user_id = $1 AND role = $2`,
    [session.userId, TEAM_ROLES.OWNER],
  )
  if (Number(countRes.rows[0].cnt) >= 5) {
    return NextResponse.json({ error: "Maximum 5 teams per user." }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36)
    const teamRes = await client.query(
      "INSERT INTO teams (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id, name, slug, created_at",
      [name.trim(), slug, session.userId],
    )
    const team = teamRes.rows[0]
    await client.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
      [team.id, session.userId, TEAM_ROLES.OWNER],
    )
    await client.query("COMMIT")
    return NextResponse.json({ team: { ...team, role: TEAM_ROLES.OWNER, member_count: 1 } })
  } catch {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: "Failed to create team." }, { status: 500 })
  } finally {
    client.release()
  }
}

// Rename a team
export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const { teamId, name } = await request.json()
  if (!teamId || !name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
    return NextResponse.json({ error: "Team name must be 2-50 characters." }, { status: 400 })
  }

  // Only owner/admin can rename
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )
  if (memberRes.rows.length === 0 || memberRes.rows[0].role === TEAM_ROLES.VIEWER) {
    return NextResponse.json({ error: "Only owners/admins can rename teams." }, { status: 403 })
  }

  await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [name.trim(), teamId])
  return NextResponse.json({ success: true, name: name.trim() })
}

// Delete a team
export async function DELETE(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const { teamId } = await request.json()
  if (!teamId) return NextResponse.json({ error: "teamId required." }, { status: 400 })

  // Only owner can delete
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  )
  if (memberRes.rows.length === 0 || memberRes.rows[0].role !== TEAM_ROLES.OWNER) {
    return NextResponse.json({ error: "Only team owners can delete teams." }, { status: 403 })
  }

  await pool.query("DELETE FROM team_invites WHERE team_id = $1", [teamId])
  await pool.query("DELETE FROM team_members WHERE team_id = $1", [teamId])
  await pool.query("DELETE FROM teams WHERE id = $1", [teamId])

  return NextResponse.json({ success: true })
}
