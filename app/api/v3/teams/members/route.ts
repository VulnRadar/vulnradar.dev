import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import {
  sendEmail,
  teamInviteEmail,
  teamMemberRemovedEmail,
  teamRoleChangedEmail,
} from "@/lib/email/email";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import {
  ERROR_MESSAGES,
  TEAM_ROLES,
  TEAM_ROLE_INVITE_LABELS,
  APP_URL,
  hasTeamPermission,
} from "@/lib/config/constants";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
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
  // Derived from TEAM_ROLES itself, not a second hand-typed list -- OWNER
  // is the only one excluded (there is exactly one owner per team, set at
  // creation in the POST above, never granted through an invite), so a
  // future role added to TEAM_ROLES becomes invitable automatically
  // instead of silently 400ing until someone remembers to list it here too.
  const INVITABLE_TEAM_ROLES: string[] = Object.values(TEAM_ROLES).filter(
    (r) => r !== TEAM_ROLES.OWNER,
  );
  if (!INVITABLE_TEAM_ROLES.includes(role)) {
    return NextResponse.json(
      {
        error: `Invalid role. Use one of: ${INVITABLE_TEAM_ROLES.join(", ")}.`,
      },
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

  // owner/admin/manager all hold "manage_members" -- see
  // TEAM_ROLE_PERMISSIONS in lib/config/constants.ts.
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (
    memberRes.rows.length === 0 ||
    !hasTeamPermission(memberRes.rows[0].role, "manage_members")
  ) {
    return NextResponse.json(
      { error: "You don't have permission to invite members." },
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
      const roleLabel = TEAM_ROLE_INVITE_LABELS[role] || role;
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
      !hasTeamPermission(memberRes.rows[0].role, "manage_members")
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

  // owner/admin/manager all hold "manage_members".
  if (!hasTeamPermission(myRole.rows[0].role, "manage_members")) {
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

  // Look up the team name and the removed member's address before the delete
  // so we can tell them they lost access. The users row survives (only the
  // membership is removed), so this could run after too, but reading it here
  // keeps the notify block self-contained.
  const [teamRow, removedUser] = await Promise.all([
    pool.query<{ name: string }>("SELECT name FROM teams WHERE id = $1", [
      teamId,
    ]),
    pool.query<{ email: string }>("SELECT email FROM users WHERE id = $1", [
      userId,
    ]),
  ]);

  await pool.query(
    "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, userId],
  );

  // Notify the removed member. Gated on the team_changes preference and
  // best-effort: a mail failure must never fail the removal itself.
  const teamName = teamRow.rows[0]?.name;
  const removedEmail = removedUser.rows[0]?.email;
  if (teamName && removedEmail) {
    const removedUserId = Number(userId);
    setImmediate(() => {
      sendNotificationEmail({
        userId: removedUserId,
        userEmail: removedEmail,
        type: "team_changes",
        emailContent: teamMemberRemovedEmail(teamName),
      }).catch((err) =>
        console.error("Team member removed email failed:", err),
      );
    });
  }

  return NextResponse.json({ success: true });
}

// Change a member's role
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const { teamId, userId, role } = await request.json();
  if (!teamId || !userId || !role)
    return NextResponse.json(
      { error: "teamId, userId and role required." },
      { status: 400 },
    );

  // Owner is never assignable through here (there is exactly one owner, set
  // at team creation) -- same derivation the invite path uses, so a new role
  // added to TEAM_ROLES becomes assignable automatically.
  const ASSIGNABLE_TEAM_ROLES: string[] = Object.values(TEAM_ROLES).filter(
    (r) => r !== TEAM_ROLES.OWNER,
  );
  if (!ASSIGNABLE_TEAM_ROLES.includes(role)) {
    return NextResponse.json(
      {
        error: `Invalid role. Use one of: ${ASSIGNABLE_TEAM_ROLES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // Caller must hold manage_members on this team.
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (
    memberRes.rows.length === 0 ||
    !hasTeamPermission(memberRes.rows[0].role, "manage_members")
  ) {
    return NextResponse.json(
      { error: "You don't have permission to change roles." },
      { status: 403 },
    );
  }

  // Changing your own role through here would let an admin lock themselves
  // out of manage_members mid-request; keep it simple and disallow it.
  if (Number(userId) === session.userId) {
    return NextResponse.json(
      { error: "You can't change your own role." },
      { status: 400 },
    );
  }

  const targetRes = await pool.query<{
    role: string;
    email: string;
    name: string | null;
  }>(
    `SELECT tm.role, u.email, u.name
     FROM team_members tm JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = $1 AND tm.user_id = $2`,
    [teamId, userId],
  );
  if (targetRes.rows.length === 0) {
    return NextResponse.json({ error: "Not a team member." }, { status: 404 });
  }
  const oldRole = targetRes.rows[0].role;
  if (oldRole === TEAM_ROLES.OWNER) {
    return NextResponse.json(
      { error: "Cannot change the team owner's role." },
      { status: 400 },
    );
  }
  if (oldRole === role) {
    // No-op: nothing to write, nothing to notify.
    return NextResponse.json({ success: true, role });
  }

  await pool.query(
    "UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3",
    [role, teamId, userId],
  );

  // Notify the member their role changed. Gated on the team_changes
  // preference and best-effort so a mail failure never fails the change.
  const teamRow = await pool.query<{ name: string }>(
    "SELECT name FROM teams WHERE id = $1",
    [teamId],
  );
  const teamName = teamRow.rows[0]?.name;
  const targetEmail = targetRes.rows[0].email;
  if (teamName && targetEmail) {
    const targetUserId = Number(userId);
    setImmediate(() => {
      sendNotificationEmail({
        userId: targetUserId,
        userEmail: targetEmail,
        type: "team_changes",
        emailContent: teamRoleChangedEmail(teamName, oldRole, role),
      }).catch((err) => console.error("Team role changed email failed:", err));
    });
  }

  return NextResponse.json({ success: true, role });
}
