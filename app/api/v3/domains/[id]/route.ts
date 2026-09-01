import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getAssignableTeamIds } from "@/lib/auth/team-resource-access";

/**
 * PATCH /api/v3/domains/[id]: assign a verified domain to a team, or move
 * it back to personal.
 *
 * domains.team_id has existed since the column was added and GET
 * /api/v3/domains already reads it for team access, but nothing could ever
 * write it: there was no PATCH route, the INSERT omits the column, and the
 * profile UI hardcodes team_id: null, while the teams docs advertise
 * team-shared domains as a feature. So the read path, the access rule in
 * lib/domains/scope.ts, and the docs claim were all gated on a value that
 * could not exist (AUDIT-011#drift-22).
 *
 * Owner-only, matching the equivalent rule on webhooks: a team member with
 * write access may use a shared domain, but deciding which team a proof of
 * domain ownership is shared with belongs to whoever proved it. The 404 for
 * a domain that is not the caller's own is deliberate -- there is no
 * read-only variant of this action, so a non-owner learns nothing about
 * whether the id exists.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "Invalid domain id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    teamId?: unknown;
  };
  if (!("teamId" in body)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const { teamId } = body;
  if (teamId !== null && !Number.isInteger(teamId)) {
    return NextResponse.json(
      { error: "teamId must be a number or null" },
      { status: 400 },
    );
  }

  if (teamId !== null) {
    // getAssignableTeamIds returns only the teams this caller may write
    // into, so a member of a team they can merely read cannot push a domain
    // into it, and a team they do not belong to at all is simply absent.
    const assignable = await getAssignableTeamIds(session.userId);
    if (!assignable.includes(teamId as number)) {
      return NextResponse.json(
        { error: "You cannot assign this domain to that team." },
        { status: 400 },
      );
    }
  }

  const result = await pool.query(
    `UPDATE domains SET team_id = $1
      WHERE id = $2 AND user_id = $3
      RETURNING id, domain, team_id, status, verification_method, created_at,
                verified_at, last_checked_at, last_check_error`,
    [teamId, id, session.userId],
  );

  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Domain not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}
