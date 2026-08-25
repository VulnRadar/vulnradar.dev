import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * Everyone the caller shares a team with, deduped across all their teams
 * (excluding themselves). Used to populate the remediation "Assignee" picker
 * so a finding can be handed to a real teammate instead of a free-typed name.
 * Read-only and self-scoped: it only ever returns people already on a team
 * with the caller.
 */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const res = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.avatar_url
       FROM team_members me
       JOIN team_members other
         ON other.team_id = me.team_id AND other.user_id <> me.user_id
       JOIN users u ON u.id = other.user_id
      WHERE me.user_id = $1
      ORDER BY u.name NULLS LAST, u.email`,
    [session.userId],
  );

  return NextResponse.json({ teammates: res.rows });
}
