import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requireModerator,
  requireAdmin,
  logAuditAction,
} from "@/lib/auth/authorization";

// List all teams with stats
export async function GET(request: Request) {
  const admin = await requireModerator();
  if (!admin)
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const searchEscaped = search.replace(/[\\%_]/g, "\\$&");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "10", 10)),
  );
  const offset = (page - 1) * limit;

  // Count total teams
  const countQuery = search
    ? `SELECT COUNT(*) FROM teams WHERE LOWER(name) LIKE LOWER($1) ESCAPE '\\'`
    : `SELECT COUNT(*) FROM teams`;
  const countParams = search ? [`%${searchEscaped}%`] : [];
  const countRes = await pool.query(countQuery, countParams);
  const totalTeams = parseInt(countRes.rows[0].count, 10);
  const totalPages = Math.ceil(totalTeams / limit);

  // Fetch teams with owner info and member count
  const teamsQuery = `
    SELECT 
      t.id,
      t.name,
      t.slug,
      t.created_at,
      t.owner_id,
      u.email as owner_email,
      u.name as owner_name,
      u.avatar_url as owner_avatar_url,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
    FROM teams t
    LEFT JOIN users u ON u.id = t.owner_id
    ${search ? "WHERE LOWER(t.name) LIKE LOWER($1) ESCAPE '\\'" : ""}
    ORDER BY t.created_at DESC
    LIMIT $${search ? 2 : 1} OFFSET $${search ? 3 : 2}
  `;
  const teamsParams = search
    ? [`%${searchEscaped}%`, limit, offset]
    : [limit, offset];
  const teamsRes = await pool.query(teamsQuery, teamsParams);

  return NextResponse.json({
    teams: teamsRes.rows,
    page,
    totalPages,
    totalTeams,
  });
}

// Update team (admin override)
export async function PATCH(request: Request) {
  const admin = await requireModerator();
  if (!admin)
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 },
    );

  const { teamId, name } = await request.json();
  if (!teamId)
    return NextResponse.json({ error: "teamId required" }, { status: 400 });
  const maxTeamNameLength = await getSetting("MAX_TEAM_NAME_LENGTH");
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > maxTeamNameLength
  ) {
    return NextResponse.json(
      { error: `Team name must be 2-${maxTeamNameLength} characters` },
      { status: 400 },
    );
  }

  // Get current team data for audit
  const teamRes = await pool.query("SELECT name FROM teams WHERE id = $1", [
    teamId,
  ]);
  if (teamRes.rows.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const oldName = teamRes.rows[0].name;

  // Update team
  await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [
    name.trim(),
    teamId,
  ]);

  // Log audit
  // audit-log: trusted client IP only.
  const ip = (await getClientIp()) || null;
  // Use the central logAuditAction helper so any email substring in
  // the details string is auto-masked (regression of AUDIT-001#secrets-02).
  await logAuditAction(
    admin.userId,
    null,
    "edit_team",
    `Renamed team from "${oldName}" to "${name.trim()}" (ID: ${teamId})`,
    ip ?? undefined,
  );

  return NextResponse.json({ success: true, name: name.trim() });
}

// Delete team (admin override)
export async function DELETE(request: Request) {
  // Only full admins (or the super admin) can delete teams -- requireAdmin
  // (not requireModerator) enforces that stricter hierarchy floor.
  const admin = await requireAdmin();
  if (!admin)
    return NextResponse.json(
      { error: "Only admins can delete teams" },
      { status: 403 },
    );

  const { teamId } = await request.json();
  if (!teamId)
    return NextResponse.json({ error: "teamId required" }, { status: 400 });

  // Get team data for audit
  const teamRes = await pool.query(
    `SELECT t.name, t.owner_id, u.email as owner_email,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count
     FROM teams t
     LEFT JOIN users u ON u.id = t.owner_id
     WHERE t.id = $1`,
    [teamId],
  );
  if (teamRes.rows.length === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const team = teamRes.rows[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Delete team members first
    await client.query("DELETE FROM team_members WHERE team_id = $1", [teamId]);

    // Delete team
    await client.query("DELETE FROM teams WHERE id = $1", [teamId]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to delete team:", err);
    return NextResponse.json(
      { error: "Failed to delete team" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  // Log audit
  // audit-log: trusted client IP only.
  const ip = (await getClientIp()) || null;
  // Use the central logAuditAction helper so `team.owner_email` is
  // auto-masked instead of being persisted plaintext (regression of
  // AUDIT-001#secrets-02).
  await logAuditAction(
    admin.userId,
    team.owner_id,
    "delete_team",
    `Deleted team "${team.name}" (${team.member_count} members, owner: ${team.owner_email})`,
    ip ?? undefined,
  );

  return NextResponse.json({ success: true });
}
