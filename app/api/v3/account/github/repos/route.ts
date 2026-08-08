import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getDecryptedGithubToken } from "@/lib/github/github-connections";
import { listUserRepos } from "@/lib/github/github-api";

// GET /api/v3/account/github/repos — list the connected account's repos
// so the user can pick one to scan.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await getDecryptedGithubToken(session.userId);
    if (!token) {
      return NextResponse.json(
        { error: "Connect your GitHub account first." },
        { status: 400 },
      );
    }

    const repos = await listUserRepos(token);
    return NextResponse.json({ repos });
  } catch (error) {
    console.error("GitHub repo list error:", error);
    return NextResponse.json(
      { error: "Failed to list GitHub repositories" },
      { status: 500 },
    );
  }
}
