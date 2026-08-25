import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { markTeamInviteNotificationsHandled } from "@/lib/notifications/user-notifications";

/**
 * The current user's OWN pending team invitations, matched by their email, so
 * they can accept or decline them right on the teams page instead of only from
 * the emailed link or the notification bell. Accepting stays the existing
 * POST /api/v3/teams/accept-invite (by inviteId, email-match enforced); this
 * route lists them (GET) and declines them (DELETE).
 */
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [
    session.userId,
  ]);
  const email = userRes.rows[0]?.email;
  if (!email) return NextResponse.json({ invitations: [] });

  const invites = await pool.query(
    `SELECT ti.id, ti.role, ti.created_at, ti.expires_at,
            t.name AS team_name,
            inviter.name AS invited_by_name
     FROM team_invites ti
     JOIN teams t ON t.id = ti.team_id
     LEFT JOIN users inviter ON inviter.id = ti.invited_by
     WHERE ti.email = $1 AND ti.accepted_at IS NULL AND ti.expires_at > NOW()
     ORDER BY ti.created_at DESC`,
    [email],
  );

  return NextResponse.json({ invitations: invites.rows });
}

// Decline one of the caller's own pending invitations.
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { inviteId } = await request.json();
  if (!inviteId)
    return NextResponse.json({ error: "inviteId required." }, { status: 400 });

  const userRes = await pool.query("SELECT email FROM users WHERE id = $1", [
    session.userId,
  ]);
  const email = userRes.rows[0]?.email;
  if (!email)
    return NextResponse.json(
      { error: "Your account has no email address." },
      { status: 400 },
    );

  // Scope the delete to the caller's own email so an inviteId (a small,
  // guessable integer) can't be used to decline someone else's invite.
  const del = await pool.query(
    "DELETE FROM team_invites WHERE id = $1 AND email = $2 AND accepted_at IS NULL",
    [inviteId, email],
  );
  if (!del.rowCount) {
    return NextResponse.json(
      { error: "Invitation not found." },
      { status: 404 },
    );
  }

  // Clear the bell notification for this invite, if one was created, so it
  // doesn't linger after being declined.
  try {
    await markTeamInviteNotificationsHandled(Number(inviteId));
  } catch (err) {
    console.error(
      "Failed to mark declined team invite notification handled:",
      err,
    );
  }

  return NextResponse.json({ success: true });
}
