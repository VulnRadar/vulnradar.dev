import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { markTeamInviteNotificationsHandled } from "@/lib/notifications/user-notifications";
import { teamsDisabledResponse } from "@/lib/teams/feature-gate";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { teamInviteResolvedEmail } from "@/lib/email/email";

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

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  // email_verified_at, not just email: the same boundary POST
  // /api/v3/teams/accept-invite enforces. An account can point itself at any
  // unclaimed address (PATCH /api/v3/auth/update) and keep its session, so
  // listing by users.email alone would show a stranger's pending invites --
  // team name and inviter name included -- to whoever typed that address in.
  // An unverified account simply has no invitations to show yet.
  const userRes = await pool.query(
    "SELECT email, email_verified_at FROM users WHERE id = $1",
    [session.userId],
  );
  const email = userRes.rows[0]?.email;
  if (!email || !userRes.rows[0]?.email_verified_at)
    return NextResponse.json({ invitations: [] });

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

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { inviteId } = await request.json();
  if (!inviteId)
    return NextResponse.json({ error: "inviteId required." }, { status: 400 });

  const userRes = await pool.query(
    "SELECT email, email_verified_at FROM users WHERE id = $1",
    [session.userId],
  );
  const email = userRes.rows[0]?.email;
  if (!email)
    return NextResponse.json(
      { error: "Your account has no email address." },
      { status: 400 },
    );
  // Declining is destructive: it deletes the invite outright. Same
  // verified-address requirement the accept and list paths use, so an
  // account that has only claimed an address (never proved it) cannot
  // destroy a pending invite belonging to whoever really owns it.
  if (!userRes.rows[0]?.email_verified_at)
    return NextResponse.json(
      {
        error:
          "Verify your email address before answering a team invitation. Use the verification link we sent to it, or request a new one from your profile.",
      },
      { status: 403 },
    );

  // Scope the delete to the caller's own email so an inviteId (a small,
  // guessable integer) can't be used to decline someone else's invite.
  // RETURNING, because the row carrying "who sent this" is gone by the time
  // anyone could look it up, and the inviter is the one person who needs to
  // know the answer.
  const del = await pool.query<{ invited_by: number | null; team_id: number }>(
    `DELETE FROM team_invites
       WHERE id = $1 AND email = $2 AND accepted_at IS NULL
       RETURNING invited_by, team_id`,
    [inviteId, email],
  );
  if (!del.rowCount) {
    return NextResponse.json(
      { error: "Invitation not found." },
      { status: 404 },
    );
  }

  const declined = del.rows?.[0];
  if (declined?.invited_by && declined.invited_by !== session.userId) {
    const invitedBy = declined.invited_by;
    void (async () => {
      try {
        const inviter = await pool.query<{ email: string; team_name: string }>(
          `SELECT u.email, t.name AS team_name
             FROM users u, teams t
            WHERE u.id = $1 AND t.id = $2`,
          [invitedBy, declined.team_id],
        );
        const row = inviter.rows?.[0];
        if (!row) return;
        await sendNotificationEmail({
          userId: invitedBy,
          userEmail: row.email,
          type: "team_changes",
          emailContent: teamInviteResolvedEmail(row.team_name, email, false),
        });
      } catch (err) {
        console.error("Failed to notify inviter of decline:", err);
      }
    })();
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
