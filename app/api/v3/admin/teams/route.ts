import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp } from "@/lib/api/request-utils";
import {
  requirePermission,
  requireAdmin,
  logAuditAction,
} from "@/lib/auth/authorization";
import { STAFF_PERMISSIONS } from "@/lib/auth/permissions-client";

// List all teams with stats
export async function GET(request: Request) {
  // VIEW_ALL_TEAMS is an admin-only grant (moderators don't hold it), so use
  // the granular permission rather than a coarse moderator-tier floor, which
  // over-granted the cross-tenant team list to moderators. (The
  // requireModerator() helper that floor came from has since been deleted: it
  // had no call sites left once every route moved to requirePermission.)
  const admin = await requirePermission(STAFF_PERMISSIONS.VIEW_ALL_TEAMS);
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

  // audit: this GET is not written to admin_audit_log, matching the paged
  // user list in app/api/v3/admin/route.ts. Both are browse surfaces the
  // panel refetches on every keystroke of the search box, so logging them
  // would bury the reads that matter under a row per page load. The reads
  // that do get logged are the ones that open a single record
  // (view_user_detail) and the exports.
  // Count total teams
  const countQuery = search
    ? `SELECT COUNT(*) FROM teams WHERE LOWER(name) LIKE LOWER($1) ESCAPE '\\'`
    : `SELECT COUNT(*) FROM teams`;
  const countParams = search ? [`%${searchEscaped}%`] : [];

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

  // perf: COUNT(*) scans the whole matching set whatever the sibling LIMIT
  // is, so awaiting it before the page query doubled the wall time of every
  // load for nothing. The two are independent. Every other admin list route
  // already pairs them this way.
  const [countRes, teamsRes] = await Promise.all([
    pool.query<{ count: string }>(countQuery, countParams),
    pool.query(teamsQuery, teamsParams),
  ]);
  const total = parseInt(countRes.rows[0].count, 10);
  const totalPages = Math.ceil(total / limit);

  // Named `total`, like every other paginated admin list (content,
  // email-logs, error-logs). It used to be `totalTeams`, which is the same
  // concept under a name no shared reader looks for: the panel's generic
  // "N total" footer reads `data.total`, so against this endpoint it silently
  // rendered 0 and the teams list dropped its count entirely.
  return NextResponse.json({
    teams: teamsRes.rows,
    page,
    totalPages,
    total,
  });
}

// Update team (admin override)
export async function PATCH(request: Request) {
  // Renaming any team is an admin-only capability (MANAGE_ANY_TEAM), not a
  // moderator one -- match the permission model rather than the coarse floor.
  const admin = await requirePermission(STAFF_PERMISSIONS.MANAGE_ANY_TEAM);
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
  // enforces that stricter hierarchy floor.
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
