import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { sendEmail, teamInviteEmail } from "@/lib/email/email";
import {
  ERROR_MESSAGES,
  TEAM_ROLES,
  APP_URL,
  RATE_LIMITS,
} from "@/lib/config/constants";
import { checkRateLimit } from "@/lib/rate-limiting/rate-limit";
import { getSetting } from "@/lib/config/runtime-config";
import { getClientIp } from "@/lib/api/request-utils";
import { logAction } from "@/lib/auth/authorization";
import { createUserNotification } from "@/lib/notifications/user-notifications";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";

// Get team members
export async function GET(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { searchParams } = new URL(request.url);
  const teamId = searchParams.get("teamId");
  if (!teamId)
    return NextResponse.json({ error: "teamId required." }, { status: 400 });

  // Verify membership
  const memberCheck = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (memberCheck.rows.length === 0) {
    return NextResponse.json({ error: "Not a team member." }, { status: 403 });
  }

  const members = await pool.query(
    `SELECT tm.user_id, tm.role, tm.joined_at, u.name, u.email, u.avatar_url, u.role as staff_role
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1 ORDER BY tm.role, u.name`,
    [teamId],
  );

  const invites = await pool.query(
    `SELECT id, email, role, created_at, expires_at FROM team_invites
     WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [teamId],
  );

  return NextResponse.json({
    members: members.rows,
    invites: invites.rows,
    currentRole: memberCheck.rows[0].role,
  });
}

// Invite a member
export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { teamId, email, role = "viewer" } = await request.json();
  if (!teamId || !email)
    return NextResponse.json(
      { error: "teamId and email required." },
      { status: 400 },
    );
  if (![TEAM_ROLES.ADMIN, TEAM_ROLES.VIEWER].includes(role)) {
    return NextResponse.json(
      { error: "Invalid role. Use 'admin' or 'viewer'." },
      { status: 400 },
    );
  }

  // Guard against invite-spam abuse (ref: AUDIT-006#team-01)
  const rl = await checkRateLimit({
    key: `team-invite:${session.userId}`,
    ...RATE_LIMITS.teamInvite,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many invitations sent. Please try again later." },
      { status: 429 },
    );
  }

  // Must be owner or admin
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (
    memberRes.rows.length === 0 ||
    !["owner", "admin"].includes(memberRes.rows[0].role)
  ) {
    return NextResponse.json(
      { error: "Only owners/admins can invite members." },
      { status: 403 },
    );
  }

  // Check if already a member
  const existingUser = await pool.query(
    "SELECT id FROM users WHERE email = $1",
    [email.trim().toLowerCase()],
  );
  if (existingUser.rows.length > 0) {
    const existingMember = await pool.query(
      "SELECT id FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, existingUser.rows[0].id],
    );
    if (existingMember.rows.length > 0) {
      return NextResponse.json(
        { error: "User is already a team member." },
        { status: 400 },
      );
    }
  }

  // Check for existing pending invite
  const existingInvite = await pool.query(
    "SELECT id FROM team_invites WHERE team_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > NOW()",
    [teamId, email.trim().toLowerCase()],
  );
  if (existingInvite.rows.length > 0) {
    return NextResponse.json(
      { error: "An invite is already pending for this email." },
      { status: 400 },
    );
  }

  // The team's member cap is governed by its owner's plan, not the
  // inviter's — an admin on someone else's team doesn't get to exceed the
  // limit the owner is actually paying for.
  const ownerRes = await pool.query(
    "SELECT owner_id FROM teams WHERE id = $1",
    [teamId],
  );
  const ownerId = ownerRes.rows[0]?.owner_id;
  if (ownerId) {
    const planLimits = await getUserPlanLimits(ownerId);
    if (planLimits) {
      const seatCountRes = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM team_members WHERE team_id = $1) +
           (SELECT COUNT(*)::int FROM team_invites
              WHERE team_id = $1 AND accepted_at IS NULL AND expires_at > NOW()) AS seats`,
        [teamId],
      );
      const seats = seatCountRes.rows[0]?.seats ?? 0;
      if (!withinPlanLimit(seats, planLimits.teamMembers)) {
        return NextResponse.json(
          { error: planLimitMessage("Team members", planLimits.teamMembers) },
          { status: 400 },
        );
      }
    }
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const inviteExpiryDays = await getSetting("TEAM_INVITE_EXPIRY_DAYS");
  const expiresAt = new Date(
    Date.now() + inviteExpiryDays * 24 * 60 * 60 * 1000,
  );

  const inviteInsert = await pool.query(
    `INSERT INTO team_invites (team_id, email, role, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      teamId,
      email.trim().toLowerCase(),
      role,
      session.userId,
      tokenHash,
      expiresAt,
    ],
  );
  const inviteId = inviteInsert.rows[0].id;

  // An existing account's id, if the invited email already belongs to one.
  // Used below to deliver an in-app bell notification in addition to email;
  // an invite to an email with no account yet just sends the email, no
  // in-app notification is possible until that person signs up.
  const invitedUserId = existingUser.rows[0]?.id ?? null;

  // audit-log: trusted client IP only.
  const ip = (await getClientIp()) || null;

  // Get team name and inviter name for email
  const teamInfo = await pool.query("SELECT name FROM teams WHERE id = $1", [
    teamId,
  ]);
  const inviterInfo = await pool.query("SELECT name FROM users WHERE id = $1", [
    session.userId,
  ]);

  if (teamInfo.rows.length > 0 && inviterInfo.rows.length > 0) {
    const teamName = teamInfo.rows[0].name;
    const invitedBy = inviterInfo.rows[0].name;
    const inviteLink = `${APP_URL}/teams/join?token=${token}`;
    const emailPayload = teamInviteEmail(teamName, inviteLink, invitedBy);

    // Look up unsubscribe token for the invitee if they're an existing user
    const inviteeRes = await pool.query<{ unsubscribe_token: string | null }>(
      "SELECT unsubscribe_token FROM users WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    const unsubscribeToken = inviteeRes.rows[0]?.unsubscribe_token ?? undefined;

    // Send email in background
    queueMicrotask(() => {
      sendEmail({
        to: email.trim().toLowerCase(),
        ...emailPayload,
        unsubscribeToken,
      }).catch((err) => {
        console.error("Team invite email failed:", err);
      });
    });

    // Also deliver an in-app bell notification when the invitee already
    // has an account, so they see it immediately if already logged in
    // instead of only finding out on their next email check.
    if (invitedUserId) {
      const roleLabel = role === TEAM_ROLES.ADMIN ? "an admin" : "a viewer";
      try {
        await createUserNotification({
          userId: invitedUserId,
          type: "team_invite",
          title: `Team invite from ${invitedBy}`,
          message: `${invitedBy} invited you to join "${teamName}" as ${roleLabel}.`,
          relatedType: "team_invite",
          relatedId: inviteId,
        });
      } catch (err) {
        console.error("Failed to create team invite notification:", err);
      }
    }

    await logAction(
      session.userId,
      invitedUserId,
      "team_invite.sent",
      `Invited ${email.trim().toLowerCase()} to team "${teamName}" as ${role} (invite #${inviteId}).`,
      ip ?? undefined,
    );
  }

  return NextResponse.json({ message: "Invite sent." });
}

// Remove a member
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { teamId, userId, inviteId } = await request.json();

  // Handle cancel invite
  if (inviteId) {
    const memberRes = await pool.query(
      "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, session.userId],
    );
    if (
      memberRes.rows.length === 0 ||
      !["owner", "admin"].includes(memberRes.rows[0].role)
    ) {
      return NextResponse.json(
        { error: "Insufficient permissions." },
        { status: 403 },
      );
    }
    await pool.query(
      "DELETE FROM team_invites WHERE id = $1 AND team_id = $2",
      [inviteId, teamId],
    );
    return NextResponse.json({ success: true });
  }

  if (!teamId || !userId)
    return NextResponse.json(
      { error: "teamId and userId required." },
      { status: 400 },
    );

  // Can't remove yourself unless you're the owner leaving
  const myRole = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (myRole.rows.length === 0)
    return NextResponse.json({ error: "Not a member." }, { status: 403 });

  if (userId === session.userId) {
    // Leaving the team (owners can't leave)
    if (myRole.rows[0].role === TEAM_ROLES.OWNER) {
      return NextResponse.json(
        {
          error: "Owners cannot leave. Transfer ownership or delete the team.",
        },
        { status: 400 },
      );
    }
    await pool.query(
      "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, userId],
    );
    return NextResponse.json({ success: true });
  }

  // Only owner/admin can remove others
  if (!["owner", "admin"].includes(myRole.rows[0].role)) {
    return NextResponse.json(
      { error: "Insufficient permissions." },
      { status: 403 },
    );
  }

  // Can't remove owner
  const targetRole = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  );
  if (
    targetRole.rows.length > 0 &&
    targetRole.rows[0].role === TEAM_ROLES.OWNER
  ) {
    return NextResponse.json(
      { error: "Cannot remove the team owner." },
      { status: 400 },
    );
  }

  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  );
  return NextResponse.json({ success: true });
}
