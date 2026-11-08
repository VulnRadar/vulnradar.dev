import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGithubConnection,
  getDecryptedGithubToken,
  deleteGithubConnection,
} from "@/lib/github/github-connections";
import { getSelectedRepos, isGithubTimeout } from "@/lib/github/github-api";
import { ApiResponse, parseBody, withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";
import pool from "@/lib/database/db";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";

/** What a linked GitHub sign-in can offer the profile, from the users row
 *  (handleOAuthLink writes it; repo access in github_connections is separate
 *  and carries no display name or picture). */
async function readLinkedProfile(userId: number) {
  const result = await pool.query<{
    github_id: string | null;
    github_name: string | null;
    github_avatar_url: string | null;
  }>(
    "SELECT github_id, github_name, github_avatar_url FROM users WHERE id = $1",
    [userId],
  );
  const row = result.rows[0];
  if (!row?.github_id) return null;
  return { name: row.github_name, avatarUrl: row.github_avatar_url };
}

/** The stored value came from GitHub's API, and users.avatar_url renders on
 *  public pages, so it is held to the one host the CSP allows for it. */
function isGithubAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "avatars.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

// GET /api/v3/account/github — GitHub connection status (never returns the token).
//
// ?include=selected-repos also looks up the repos in the connection's working
// set (selectedRepos) and returns them as `repos`, so app/repos can render in
// one request what used to take this one followed by a listing of every repo
// the account can see. Only the selected ones are asked for (by name, or from
// one listing when the selection is long: see getSelectedRepos). A GitHub failure
// there does not fail the status: the connection and the names are still
// true, so it comes back as `workingSetError` beside them and `repos` is left
// out, which the page must not read as an empty selection.
//
// ?include=linked-profile answers only with the linked sign-in's stored name and
// avatar, for components/modals/github-profile-modal.tsx.
export const GET = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }

  try {
    const include = new URL(request.url).searchParams.get("include");
    if (include === "linked-profile") {
      return NextResponse.json({
        linkedProfile: await readLinkedProfile(session.userId),
      });
    }

    const connection = await getGithubConnection(session.userId);
    if (!connection) {
      return NextResponse.json({ connected: false });
    }
    const status = {
      connected: true,
      githubUsername: connection.githubUsername,
      scopes: connection.scopes,
      connectedAt: connection.connectedAt,
      updatedAt: connection.updatedAt,
      // The curated working set from the repo picker modal (app/repos) --
      // included here so that page's initial status fetch already knows
      // what to auto-load without a second round trip.
      selectedRepos: connection.selectedRepos,
    };

    if (include !== "selected-repos") {
      return NextResponse.json(status);
    }
    if (connection.selectedRepos.length === 0) {
      return NextResponse.json({ ...status, repos: [] });
    }

    try {
      const token = await getDecryptedGithubToken(session.userId);
      if (!token) {
        return NextResponse.json({
          ...status,
          workingSetError: "Connect your GitHub account first.",
        });
      }
      const repos = await getSelectedRepos(token, connection.selectedRepos);
      return NextResponse.json({ ...status, repos });
    } catch (error) {
      const timedOut = isGithubTimeout(error);
      logError(
        "github",
        timedOut
          ? "GitHub did not answer while loading the selected repos"
          : "could not load the selected repos from GitHub",
        error,
        { userId: session.userId, selected: connection.selectedRepos.length },
      );
      return NextResponse.json({
        ...status,
        workingSetError: timedOut
          ? "GitHub did not answer in time, so your repositories could not be loaded."
          : "Your repositories could not be loaded from GitHub.",
      });
    }
  } catch (error) {
    logError("github", "could not check the GitHub connection", error, {
      userId: session.userId,
    });
    return NextResponse.json(
      { error: "Failed to check GitHub connection" },
      { status: 500 },
    );
  }
});

// PATCH /api/v3/account/github — copy the linked sign-in's stored name and
// avatar onto the profile. The body picks which; the values are only ever read
// from the row, so a crafted link has nothing to inject.
export const PATCH = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }

  const parsed = await parseBody<{
    syncAvatar?: unknown;
    syncName?: unknown;
  }>(request);
  if (!parsed.success) return ApiResponse.badRequest(parsed.error);
  const { syncAvatar, syncName } = parsed.data;
  if (!syncAvatar && !syncName) {
    return NextResponse.json({ success: true, updated: [] });
  }

  try {
    const profile = await readLinkedProfile(session.userId);
    if (!profile) {
      return NextResponse.json(
        { error: "No GitHub sign-in is linked to this account." },
        { status: 404 },
      );
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const updated: string[] = [];

    if (
      syncAvatar &&
      profile.avatarUrl &&
      isGithubAvatarUrl(profile.avatarUrl)
    ) {
      sets.push(`avatar_url = $${sets.length + 1}`);
      vals.push(profile.avatarUrl);
      updated.push("avatar");
      // Same as the Discord sync: an external avatar replaces the upload.
      await deleteAvatarFilesIfLocal(session.userId);
    }
    if (syncName && profile.name) {
      sets.push(`name = $${sets.length + 1}`);
      vals.push(profile.name);
      updated.push("name");
    }

    if (sets.length > 0) {
      vals.push(session.userId);
      await pool.query(
        `UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`,
        vals,
      );
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    logError("github", "could not sync the GitHub profile", error, {
      userId: session.userId,
    });
    return NextResponse.json(
      { error: "Failed to sync GitHub profile." },
      { status: 500 },
    );
  }
});

// DELETE /api/v3/account/github — disconnect the GitHub account.
export const DELETE = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }
  const refused = refuseWhileImpersonating(session, "Revoking repo access");
  if (refused) return refused;

  try {
    const deleted = await deleteGithubConnection(session.userId);
    if (!deleted) {
      return NextResponse.json(
        { error: "No GitHub connection found" },
        { status: 404 },
      );
    }
    return NextResponse.json({
      success: true,
      message: "GitHub account disconnected",
    });
  } catch (error) {
    logError("github", "could not disconnect the GitHub account", error, {
      userId: session.userId,
    });
    return NextResponse.json(
      { error: "Failed to disconnect GitHub account" },
      { status: 500 },
    );
  }
});
