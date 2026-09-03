import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { markTeamInviteNotificationsHandled } from "@/lib/notifications/user-notifications";
import { teamsDisabledResponse } from "@/lib/teams/feature-gate";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { teamInviteResolvedEmail } from "@/lib/email/email";

/**
 * Tell the person who sent an invite how it was answered.
 *
 * The invitee gets the invite mail and an in-app bell; the inviter got
 * nothing either way, so a team owner who invited five people had to keep
 * reopening the members page to find out who had actually joined. Gated on
 * team_changes, and never sent to yourself.
 */
async function notifyInviter(opts: {
  invitedBy: number | null;
  actorUserId: number;
  teamName: string;
  inviteeEmail: string;
  accepted: boolean;
}): Promise<void> {
  if (!opts.invitedBy || opts.invitedBy === opts.actorUserId) return;
  const inviter = await pool.query<{ email: string }>(
    "SELECT email FROM users WHERE id = $1",
    [opts.invitedBy],
  );
  const email = inviter.rows?.[0]?.email;
  if (!email) return;
  await sendNotificationEmail({
    userId: opts.invitedBy,
    userEmail: email,
    type: "team_changes",
    emailContent: teamInviteResolvedEmail(
      opts.teamName,
      opts.inviteeEmail,
      opts.accepted,
    ),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { token, inviteId } = await request.json();
  if (!token && !inviteId)
    return NextResponse.json(
      { error: "Invite token or inviteId required." },
      { status: 400 },
    );

  // rate-limit: sending invites was capped, accepting them was not
  // (AUDIT-002#secrets-02). The token path needs 256 bits guessed correctly
  // so it was never brute-forceable, but the inviteId path takes a small
  // sequential integer, and its two failure messages differ ("invalid or
  // already used" vs "sent to a different email address"), so an unbounded
  // caller could walk the id space and learn which invites exist and which
  // are still open. Reuses the team-invite limiter's admin-configurable
  // numbers under its own key, so accepting cannot consume the sending
  // budget or vice versa.
  const acceptRl = await checkRateLimit({
    key: `team-accept-invite:${session.userId}`,
    ...RATE_LIMITS.teamInvite,
  });
  if (!acceptRl.allowed) {
    return NextResponse.json(
      { error: "Too many invite attempts. Please try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(acceptRl.retryAfterSeconds) },
      },
    );
  }

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
        `SELECT ti.id, ti.team_id, ti.email, ti.role, ti.expires_at, ti.invited_by, t.name as team_name
         FROM team_invites ti JOIN teams t ON t.id = ti.team_id
         WHERE ti.token = $1 AND ti.accepted_at IS NULL`,
        [createHash("sha256").update(token).digest("hex")],
      )
    : await pool.query(
        `SELECT ti.id, ti.team_id, ti.email, ti.role, ti.expires_at, ti.invited_by, t.name as team_name
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

  void (async () => {
    try {
      await notifyInviter({
        invitedBy: invite.invited_by ?? null,
        actorUserId: session.userId,
        teamName: invite.team_name,
        inviteeEmail: userEmail,
        accepted: true,
      });
    } catch (err) {
      console.error("Failed to notify inviter of acceptance:", err);
    }
  })();

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
