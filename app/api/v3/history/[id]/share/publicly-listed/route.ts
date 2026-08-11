import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * PUT /api/v3/history/[id]/share/publicly-listed
 *
 * Per-share override for the Public Scans directory listing
 * (scan_history.share_publicly_listed), independent of whatever the
 * account-level default (users.share_publicly_listed_by_default) set it to
 * when the share was first created. Powers the "List publicly" / "Unlist"
 * action in the Shared page's row menu (components/shares/shares-row.tsx).
 *
 * Ownership + team-admin check mirrors POST/DELETE
 * app/api/v3/history/[id]/share/route.ts exactly: the scan owner, or a team
 * admin/owner acting on the scan owner's behalf, may flip this. Anyone else
 * gets a generic 404 -- scan existence is never leaked via a 403.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const publiclyListed = (body as Record<string, unknown> | null)
    ?.publiclyListed;

  if (typeof publiclyListed !== "boolean") {
    return NextResponse.json(
      { error: "publiclyListed must be a boolean" },
      { status: 400 },
    );
  }

  const existing = await pool.query(
    "SELECT id, share_token, user_id FROM scan_history WHERE id = $1",
    [id],
  );

  if (existing.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found" }, { status: 404 });
  }

  const scan = existing.rows[0];

  if (scan.user_id !== session.userId) {
    const teamRoleCheck = await pool.query(
      `SELECT tm1.role
       FROM team_members tm1
       JOIN team_members tm2 ON tm1.team_id = tm2.team_id
       WHERE tm1.user_id = $1 AND tm2.user_id = $2
         AND tm1.role IN ('owner', 'admin')
       LIMIT 1`,
      [session.userId, scan.user_id],
    );

    if (teamRoleCheck.rows.length === 0) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 });
    }
  }

  if (!scan.share_token) {
    return NextResponse.json(
      { error: "This scan has no active share link to list or unlist." },
      { status: 400 },
    );
  }

  await pool.query(
    "UPDATE scan_history SET share_publicly_listed = $1 WHERE id = $2",
    [publiclyListed, id],
  );

  return NextResponse.json({ publiclyListed });
}
