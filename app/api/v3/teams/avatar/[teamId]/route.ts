import { NextRequest, NextResponse } from "next/server";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { readTeamAvatarFile } from "@/lib/uploads/team-avatar-storage";

/**
 * GET /api/v3/teams/avatar/[teamId] - serve a team's stored avatar.
 *
 * The team counterpart of GET /api/v3/avatar/[userId], with one deliberate
 * difference: that route is public because user avatars already render on
 * logged-out surfaces (a shared scan report names who ran it). Nothing about a
 * team is ever shown to a logged-out visitor, so this one requires a session
 * AND membership of the team. Everything under /api/v3/teams is already off the
 * PUBLIC_PATHS allowlist, so the session check here is the second gate, not the
 * only one.
 *
 * 404, not 403, for a non-member: whether a given team id exists is itself
 * information a stranger has no business enumerating.
 */
export const GET = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ teamId: string }> },
  ) => {
    const { teamId: rawTeamId } = await params;
    const teamId = Number.parseInt(rawTeamId, 10);

    // Reject anything that isn't a canonical positive integer, so a
    // "1abc"-shaped segment can't parse to a real team id.
    if (
      !Number.isInteger(teamId) ||
      teamId <= 0 ||
      String(teamId) !== rawTeamId
    ) {
      return ApiResponse.notFound("Avatar not found.");
    }

    const session = await getSession();
    if (!session) return ApiResponse.unauthorized();

    const membership = await pool.query(
      "SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2",
      [teamId, session.userId],
    );
    if (membership.rows.length === 0) {
      return ApiResponse.notFound("Avatar not found.");
    }

    const file = await readTeamAvatarFile(teamId);
    if (!file) {
      return ApiResponse.notFound("Avatar not found.");
    }

    // Buffer's backing ArrayBufferLike isn't assignable to the DOM lib's
    // BufferSource, so copy into a plain Uint8Array for the Response body.
    const body = new Uint8Array(file.bytes);
    return new NextResponse(body, {
      headers: {
        "Content-Type": file.mime,
        // `private`, unlike the user avatar route's `public`: this response is
        // scoped to one signed-in member, so a shared cache must never hand it
        // to the next caller. Still immutable, because the URL that produced it
        // carries a `v` stamp that changes on every re-upload.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  },
);
