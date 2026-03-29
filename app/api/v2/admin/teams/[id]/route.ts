import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/database/db"
import { STAFF_ROLES, ERROR_MESSAGES } from "@/lib/config/constants"

// Check if user has admin/moderator role
async function checkAdminAccess(userId: number): Promise<boolean> {
  const res = await pool.query("SELECT role FROM users WHERE id = $1", [userId])
  if (res.rows.length === 0) return false
  const role = res.rows[0].role || "user"
  return [STAFF_ROLES.ADMIN, STAFF_ROLES.MODERATOR].includes(role)
}

// Get team details with members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 })

  const allowed = await checkAdminAccess(session.userId)
  if (!allowed) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 })

  const { id } = await params
  const teamId = parseInt(id, 10)
  if (isNaN(teamId)) return NextResponse.json({ error: "Invalid team ID" }, { status: 400 })

  // Get team info
  const teamRes = await pool.query(
    `SELECT t.id, t.name, t.slug, t.created_at, t.owner_id,
       u.email as owner_email, u.name as owner_name, u.avatar_url as owner_avatar_url
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = $1`,
    [teamId]
  )
  if (teamRes.rows.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 })
  }

  // Get team members
  const membersRes = await pool.query(
    `SELECT 
       tm.user_id,
       tm.role,
       tm.joined_at,
       u.email,
       u.name,
       u.avatar_url
     FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1
     ORDER BY 
       CASE tm.role 
         WHEN 'owner' THEN 1 
         WHEN 'admin' THEN 2 
         WHEN 'member' THEN 3 
         WHEN 'viewer' THEN 4 
       END,
       tm.joined_at`,
    [teamId]
  )

  return NextResponse.json({
    team: teamRes.rows[0],
    members: membersRes.rows,
  })
}
