import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGithubConnection,
  getDecryptedGithubToken,
  deleteGithubConnection,
} from "@/lib/github/github-connections";
import { getSelectedRepos, isGithubTimeout } from "@/lib/github/github-api";
import { withErrorHandling } from "@/lib/api/api-utils";
import { logError } from "@/lib/logging/log";

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
export const GET = withErrorHandling(async (request: Request) => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    const include = new URL(request.url).searchParams.get("include");
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

// DELETE /api/v3/account/github — disconnect the GitHub account.
export const DELETE = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
