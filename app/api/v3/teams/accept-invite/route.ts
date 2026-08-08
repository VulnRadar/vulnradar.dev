import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { markTeamInviteNotificationsHandled } from "@/lib/notifications/user-notifications";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { token, inviteId } = await request.json();
  if (!token && !inviteId)
    return NextResponse.json(
      { error: "Invite token or inviteId required." },
      { status: 400 },
    );

  // Two ways in: the emailed link carries a plaintext token (compared
  // against the stored hash, never the plaintext), while the bell's
  // in-app Accept button already knows the invite's id from the
  // notification it's rendering and doesn't have (and doesn't need) the
  // plaintext token, which is never persisted anywhere after creation.
  // Either path still has to pass the email-match check below, so an
  // inviteId alone (a small, guessable integer) can't be used to accept
  // someone else's invite.
  const inviteRes = token
    ? await pool.query(
        `SELECT ti.id, ti.team_id, ti.email, ti.role, ti.expires_at, t.name as team_name
         FROM team_invites ti JOIN teams t ON t.id = ti.team_id
         WHERE ti.token = $1 AND ti.accepted_at IS NULL`,
        [createHash("sha256").update(token).digest("hex")],
      )
    : await pool.query(
        `SELECT ti.id, ti.team_id, ti.email, ti.role, ti.expires_at, t.name as team_name
         FROM team_invites ti JOIN teams t ON t.id = ti.team_id
         WHERE ti.id = $1 AND ti.accepted_at IS NULL`,
        [inviteId],
      );

  if (inviteRes.rows.length === 0) {
    return NextResponse.json(
      { error: "Invalid or already used invite." },
      { status: 400 },
    );
  }

  const invite = inviteRes.rows[0];

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "This invite has expired." },
      { status: 400 },
    );
  }

  // Get user's email
  const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [
    session.userId,
  ]);
  const userEmail = userRes.rows[0]?.email;

  if (userEmail !== invite.email) {
    return NextResponse.json(
      { error: "This invite was sent to a different email address." },
      { status: 403 },
    );
  }

  // Check if already a member
  const existingMember = await pool.query(
    "SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2",
    [invite.team_id, session.userId],
  );
  if (existingMember.rows.length > 0) {
    return NextResponse.json(
      { error: "You are already a member of this team." },
      { status: 400 },
    );
  }

  // Accept invite
  await pool.query(
    "UPDATE team_invites SET accepted_at = NOW() WHERE id = $1",
    [invite.id],
  );
  await pool.query(
    "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
    [invite.team_id, session.userId, invite.role],
  );

  // Clear the bell notification for this invite, if one was created, so
  // it doesn't linger after being acted on.
  try {
    await markTeamInviteNotificationsHandled(invite.id);
  } catch (err) {
    console.error("Failed to mark team invite notification handled:", err);
  }

  return NextResponse.json({
    message: `You joined ${invite.team_name}!`,
    teamId: invite.team_id,
  });
}
