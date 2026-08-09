import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getGithubConnection,
  deleteGithubConnection,
} from "@/lib/github/github-connections";

// GET /api/v3/account/github — GitHub connection status (never returns the token).
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const connection = await getGithubConnection(session.userId);
    if (!connection) {
      return NextResponse.json({ connected: false });
    }
    return NextResponse.json({
      connected: true,
      githubUsername: connection.githubUsername,
      scopes: connection.scopes,
      connectedAt: connection.connectedAt,
      updatedAt: connection.updatedAt,
      // The curated working set from the repo picker modal (app/repos) --
      // included here so that page's initial status fetch already knows
      // what to auto-load without a second round trip.
      selectedRepos: connection.selectedRepos,
    });
  } catch (error) {
    console.error("GitHub connection check error:", error);
    return NextResponse.json(
      { error: "Failed to check GitHub connection" },
      { status: 500 },
    );
  }
}

// DELETE /api/v3/account/github — disconnect the GitHub account.
export async function DELETE() {
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
    console.error("GitHub disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect GitHub account" },
      { status: 500 },
    );
  }
}
