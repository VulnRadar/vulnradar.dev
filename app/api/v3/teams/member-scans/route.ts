import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { teamsDisabledResponse } from "@/lib/teams/feature-gate";
import { scanTeamMatchSql } from "@/lib/teams/scan-teams";

/** Rows returned per request. Named so the response can report it. */
const MEMBER_SCAN_LIMIT = 50;

// Get a team member's scan history
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  const userId = searchParams.get("userId");

  if (!teamId || !userId) {
    return NextResponse.json(
      { error: "teamId and userId required." },
      { status: 400 },
    );
  }

  // Verify the requester is a team member
  const requesterCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );

  if (requesterCheck.rows.length === 0) {
    return NextResponse.json({ error: "Not a team member." }, { status: 403 });
  }

  // Verify the target user is also a team member
  const targetCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  );

  if (targetCheck.rows.length === 0) {
    return NextResponse.json(
      { error: "User is not a team member." },
      { status: 404 },
    );
  }

  // Fetch the member's scans SHARED WITH THIS TEAM only. Filtering on the
  // team (not just user_id) keeps a member's private personal scans out of
  // the team view -- org isolation, the same rule the history read/share
  // paths enforce via getScanResourceAccess.
  //
  // A scan can now be shared with several teams at once, so the filter is the
  // scan_history_teams join rather than the single team_id column; the
  // predicate still matches the column too, so a run written by a path that
  // only knows the column (a scheduled run, a crawl child page) does not
  // vanish from the team's view.
  const scans = await pool.query(
    `SELECT sh.id, sh.url, sh.findings_count, sh.duration, sh.scanned_at
     FROM scan_history sh
     WHERE sh.user_id = $1 AND ${scanTeamMatchSql("sh", "$2")}
     ORDER BY sh.scanned_at DESC
     LIMIT $3`,
    [userId, teamId, MEMBER_SCAN_LIMIT],
  );

  // The row cap used to be invisible: the panel drove its paginator from
  // scans.length, so a member with 200 team scans was shown "50 of 50" and
  // the older 150 simply did not exist as far as the UI was concerned
  // (AUDIT-014#magic-20). Reporting the real total lets the client say what
  // is being withheld, and `limit` names the cap rather than leaving the
  // client to infer it from the array length.
  const totalRes = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::int AS total FROM scan_history sh
      WHERE sh.user_id = $1 AND ${scanTeamMatchSql("sh", "$2")}`,
    [userId, teamId],
  );

  return NextResponse.json({
    scans: scans.rows,
    total: Number(totalRes.rows[0]?.total ?? scans.rows.length),
    limit: MEMBER_SCAN_LIMIT,
  });
}
