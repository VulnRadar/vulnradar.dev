import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getDecryptedGithubToken,
  saveSelectedRepos,
} from "@/lib/github/github-connections";
import { listUserRepos } from "@/lib/github/github-api";

// Same bound listUserRepos itself enforces (3 pages x 100 per_page) -- a
// selection can never legitimately contain more repos than a user could
// have been shown in the picker to begin with.
const MAX_SELECTED_REPOS = 300;
const REPO_FULL_NAME_RE = /^[^/\s]+\/[^/\s]+$/;

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

// PUT /api/v3/account/github/repos — save the curated set of repos picked
// in the repo picker modal (app/repos), replacing whatever was saved
// before. This is the only write path for github_connections.selected_repos
// -- both the first-time "Load repositories" flow and the later "Edit
// selection" flow call this with the modal's full checked set.
export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { selected?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.selected)) {
    return NextResponse.json(
      { error: "selected must be an array of repo full names." },
      { status: 400 },
    );
  }
  if (body.selected.length > MAX_SELECTED_REPOS) {
    return NextResponse.json(
      { error: `You can select at most ${MAX_SELECTED_REPOS} repos.` },
      { status: 400 },
    );
  }

  const seen = new Set<string>();
  const selected: string[] = [];
  for (const raw of body.selected) {
    if (typeof raw !== "string") {
      return NextResponse.json(
        { error: "selected must be an array of repo full names." },
        { status: 400 },
      );
    }
    const name = raw.trim();
    if (!REPO_FULL_NAME_RE.test(name)) {
      return NextResponse.json(
        { error: `"${name}" doesn't look like a repo ("owner/repo").` },
        { status: 400 },
      );
    }
    if (!seen.has(name)) {
      seen.add(name);
      selected.push(name);
    }
  }

  try {
    const saved = await saveSelectedRepos(session.userId, selected);
    if (!saved) {
      return NextResponse.json(
        { error: "Connect your GitHub account first." },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, selectedRepos: selected });
  } catch (error) {
    console.error("GitHub repo selection save error:", error);
    return NextResponse.json(
      { error: "Failed to save your repo selection." },
      { status: 500 },
    );
  }
}
