import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import {
  ERROR_MESSAGES,
  TEAM_ROLES,
  hasTeamPermission,
} from "@/lib/config/constants";
import { getSetting } from "@/lib/config/runtime-config";
import {
  getUserPlanLimits,
  withinPlanLimit,
  planLimitMessage,
} from "@/lib/billing/plan-limits";
import { teamsDisabledResponse } from "@/lib/teams/feature-gate";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { teamDeletedEmail } from "@/lib/email/email";
import {
  deleteTeamAvatarFile,
  readTeamAvatarStamps,
  saveTeamAvatarFile,
  teamAvatarUrl,
} from "@/lib/uploads/team-avatar-storage";

// List user's teams
export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  // The owner columns are joined in rather than left out: components/teams/
  // teams-list.tsx renders owner_name/owner_email/owner_avatar_url on every
  // row, and with none of them selected each row read "owned by undefined"
  // over a "?" placeholder. LEFT JOIN, not JOIN, so a team can never drop out
  // of somebody's list because of a problem with its owner row.
  const result = await pool.query<{
    id: number;
    name: string;
    slug: string;
    owner_id: number;
    owner_name: string | null;
    owner_email: string | null;
    owner_avatar_url: string | null;
    created_at: Date;
    role: string;
    member_count: string;
  }>(
    `SELECT t.id, t.name, t.slug, t.owner_id, t.created_at, tm.role,
       u.name AS owner_name, u.email AS owner_email,
       u.avatar_url AS owner_avatar_url,
       (SELECT COUNT(*) FROM team_members tm2 WHERE tm2.team_id = t.id) as member_count
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = $1
     LEFT JOIN users u ON u.id = t.owner_id
     ORDER BY t.name`,
    [session.userId],
  );

  // Team pictures live in team_avatars (BYTEA in Postgres, the one image
  // mechanism this app has) and are served from /api/v3/teams/avatar/[teamId].
  // There is no teams.avatar_url column to select here: the row's own
  // updated_at is what builds the URL, so the two cannot disagree about
  // whether a team has a picture. See lib/uploads/team-avatar-storage.ts.
  const avatarStamps = await readTeamAvatarStamps(
    result.rows.map((row) => row.id),
  );
  const teams = result.rows.map((row) => ({
    ...row,
    avatar_url: teamAvatarUrl(row.id, avatarStamps.get(row.id) ?? null),
  }));

  // The caller's own plan caps: how many teams they can own and how many
  // seats a team can hold. The create dialog uses teamMembers to cap the
  // first-run invite rows. null means billing is off (unlimited); the client
  // treats that as "no cap". -1 is the plan's own "unlimited" sentinel.
  const planLimits = await getUserPlanLimits(session.userId);

  return NextResponse.json({
    teams,
    limits: planLimits
      ? { teams: planLimits.teams, teamMembers: planLimits.teamMembers }
      : null,
  });
}

// Create a new team
export async function POST(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { name } = await request.json();
  const maxTeamNameLength = await getSetting("MAX_TEAM_NAME_LENGTH");
  if (
    !name ||
    typeof name !== "string" ||
    name.trim().length < 2 ||
    name.trim().length > maxTeamNameLength
  ) {
    return NextResponse.json(
      { error: `Team name must be 2-${maxTeamNameLength} characters.` },
      { status: 400 },
    );
  }

  const countRes = await pool.query(
    `SELECT COUNT(*) as cnt FROM team_members WHERE user_id = $1 AND role = $2`,
    [session.userId, TEAM_ROLES.OWNER],
  );
  const planLimits = await getUserPlanLimits(session.userId);
  if (
    planLimits &&
    !withinPlanLimit(Number(countRes.rows[0].cnt), planLimits.teams)
  ) {
    return NextResponse.json(
      { error: planLimitMessage("Teams", planLimits.teams) },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slug =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") +
      "-" +
      Date.now().toString(36);
    const teamRes = await client.query(
      "INSERT INTO teams (name, slug, owner_id) VALUES ($1, $2, $3) RETURNING id, name, slug, created_at",
      [name.trim(), slug, session.userId],
    );
    const team = teamRes.rows[0];
    await client.query(
      "INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)",
      [team.id, session.userId, TEAM_ROLES.OWNER],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      team: { ...team, role: TEAM_ROLES.OWNER, member_count: 1 },
    });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json(
      { error: "Failed to create team." },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

// Update a team: rename it, set its picture, or clear its picture.
//
// The avatar arrives the same way a user's does on PATCH /api/v3/auth/update:
// a `data:image/png;base64,...` (or jpeg) URL produced by ImageCropDialog,
// validated by lib/uploads/avatar.ts (MIME allowlist, magic bytes, size cap)
// and stored as bytes in Postgres. "" clears it. Deliberately the same
// endpoint as the rename rather than a route of its own, mirroring the user
// path, where one PATCH carries name, email and avatar together.
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { teamId, name, avatarUrl } = await request.json();
  const wantsRename = name !== undefined;
  const wantsAvatar = typeof avatarUrl === "string";

  if (!teamId || (!wantsRename && !wantsAvatar)) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const maxTeamNameLength = await getSetting("MAX_TEAM_NAME_LENGTH");
  if (
    wantsRename &&
    (!name ||
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > maxTeamNameLength)
  ) {
    return NextResponse.json(
      { error: `Team name must be 2-${maxTeamNameLength} characters.` },
      { status: 400 },
    );
  }

  // owner/admin/manager/operator all hold "manage_team" -- see
  // TEAM_ROLE_PERMISSIONS in lib/config/constants.ts. The same permission
  // covers the picture: it is the team's public face inside the app, so
  // changing it is exactly as consequential as renaming it, and a plain
  // member or viewer must not be able to.
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (
    memberRes.rows.length === 0 ||
    !hasTeamPermission(memberRes.rows[0].role, "manage_team")
  ) {
    return NextResponse.json(
      { error: "You don't have permission to change this team." },
      { status: 403 },
    );
  }

  let storedAvatarUrl: string | null = null;
  if (wantsAvatar) {
    if (avatarUrl === "") {
      await deleteTeamAvatarFile(teamId);
    } else {
      const { validateAvatarDataUrl } = await import("@/lib/uploads/avatar");
      const result = validateAvatarDataUrl(avatarUrl);
      if (!result.valid) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }
      storedAvatarUrl = await saveTeamAvatarFile(
        teamId,
        result.mime,
        result.bytes,
      );
    }
  }

  if (wantsRename) {
    await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [
      name.trim(),
      teamId,
    ]);
  }

  return NextResponse.json({
    success: true,
    ...(wantsRename ? { name: name.trim() } : {}),
    // Present only when the caller touched the picture, and null when they
    // cleared it, so the client can tell "unchanged" from "removed".
    ...(wantsAvatar ? { avatarUrl: storedAvatarUrl } : {}),
  });
}

// Delete a team
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session)
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );

  const gate = await teamsDisabledResponse();
  if (gate) return gate;

  const { teamId } = await request.json();
  if (!teamId)
    return NextResponse.json({ error: "teamId required." }, { status: 400 });

  // "delete_team" is owner-only -- deleting is a strictly bigger blast
  // radius than renaming, so it's its own permission, not folded into
  // "manage_team" (which admin/manager/operator also hold).
  const memberRes = await pool.query(
    "SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2",
    [teamId, session.userId],
  );
  if (
    memberRes.rows.length === 0 ||
    !hasTeamPermission(memberRes.rows[0].role, "delete_team")
  ) {
    return NextResponse.json(
      { error: "Only team owners can delete teams." },
      { status: 403 },
    );
  }

  // team_members and team_invites both FK teams(id) ON DELETE CASCADE, so a
  // single delete removes them atomically. The prior three separate autocommit
  // deletes could leave a partial state if the process died between them (and
  // the first two were redundant with the cascade anyway).
  // Read the roster BEFORE the cascade, because after it there is nobody left
  // to tell. Removing one member emails them; removing all of them by deleting
  // the team told none of them, so a member's shared scans simply stopped
  // being there one day.
  let roster: { user_id: number; email: string; team_name: string }[] = [];
  try {
    const res = await pool.query<{
      user_id: number;
      email: string;
      team_name: string;
    }>(
      `SELECT tm.user_id, u.email, t.name AS team_name
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         JOIN teams t ON t.id = tm.team_id
        WHERE tm.team_id = $1 AND tm.user_id <> $2`,
      [teamId, session.userId],
    );
    roster = res.rows ?? [];
  } catch (err) {
    // Losing the roster costs the members an email. Failing the delete because
    // of it would cost the owner the operation they asked for, which is the
    // worse trade every time.
    console.error("Failed to read team roster for deletion notices:", err);
  }

  await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);

  void (async () => {
    for (const member of roster) {
      try {
        await sendNotificationEmail({
          userId: member.user_id,
          userEmail: member.email,
          type: "team_changes",
          emailContent: teamDeletedEmail(member.team_name),
        });
      } catch (err) {
        console.error("Failed to send team deleted notice:", err);
      }
    }
  })();

  return NextResponse.json({ success: true });
}
