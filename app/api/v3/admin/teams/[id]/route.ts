import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { requirePermission } from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";

// Get team details with members
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Reading any tenant's team detail (owner + member emails) is the same
  // cross-tenant PII as the list route, so it needs the admin-only
  // VIEW_ALL_TEAMS grant, not the coarse requireModerator floor -- otherwise a
  // moderator could enumerate every team by sequential id.
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_ALL_TEAMS);
  if (!admin)
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );

  const { id } = await params;
  const teamId = parseInt(id, 10);
  if (isNaN(teamId))
    return NextResponse.json({ error: "Invalid team ID" }, { status: 400 });

  // Get team info
  const teamRes = await pool.query(
    `SELECT t.id, t.name, t.slug, t.created_at, t.owner_id,
       u.email as owner_email, u.name as owner_name, u.avatar_url as owner_avatar_url
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = $1`,
    [teamId],
  );
  if (teamRes.rows.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
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
    [teamId],
  );

  return NextResponse.json({
    team: teamRes.rows[0],
    members: membersRes.rows,
  });
}
