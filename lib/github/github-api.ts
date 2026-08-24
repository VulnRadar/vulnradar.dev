/**
 * GitHub REST API calls made with a user's connected access token
 * (lib/github/github-connections.ts). Reads (repo metadata + source) for the
 * repo-scan feature, plus one write: createRepoIssue, which files a scan's
 * findings as a GitHub issue when the user explicitly asks (owner-initiated,
 * never automatic).
 *
 * Not routed through lib/scanner/safe-fetch.ts's SSRF guard: every URL
 * built here targets a fixed, hardcoded api.github.com host, never a
 * user-supplied one, so the guard that exists to stop a user pointing the
 * scanner at an internal address doesn't apply.
 */

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...API_VERSION_HEADERS };
}

export interface GithubRepoSummary {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
  description: string | null;
}

/**
 * Lists repos the connected account can access, newest-updated first.
 * Paginated up to MAX_PAGES (300 repos) — a hard bound so one account
 * with thousands of repos can't turn "list my repos" into an unbounded
 * fan-out of GitHub API calls.
 */
export async function listUserRepos(
  token: string,
): Promise<GithubRepoSummary[]> {
  const MAX_PAGES = 3;
  const PER_PAGE = 100;
  const repos: GithubRepoSummary[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${GITHUB_API_BASE}/user/repos`);
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("page", String(page));

    const res = await fetch(url.toString(), { headers: authHeaders(token) });
    if (!res.ok) {
      throw new Error(`GitHub repo list HTTP ${res.status}`);
    }
    const data = (await res.json()) as Array<{
      full_name: string;
      private: boolean;
      default_branch: string;
      updated_at: string;
      description: string | null;
    }>;

    for (const r of data) {
      repos.push({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        description: r.description,
      });
    }

    if (data.length < PER_PAGE) break; // last page
  }

  return repos;
}

export interface GithubRepoInfo {
  defaultBranch: string;
  /** Whether the repo is private -- threaded into the AI review prompt so
   *  it can weigh a hardcoded secret as already-public vs not-yet-disclosed. */
  private: boolean;
}

/**
 * Resolves a repo's default branch and visibility in one call. Visibility
 * is fetched even when the caller already has a pinned ref (it isn't tied
 * to ref resolution), since the AI review pass needs it regardless.
 */
export async function getRepoInfo(
  token: string,
  owner: string,
  repo: string,
): Promise<GithubRepoInfo> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(`GitHub repo lookup HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    default_branch?: string;
    private?: boolean;
  };
  if (!data.default_branch) {
    throw new Error("GitHub repo lookup did not return a default_branch");
  }
  return { defaultBranch: data.default_branch, private: Boolean(data.private) };
}

export interface CreatedIssue {
  number: number;
  htmlUrl: string;
}

/**
 * Files a GitHub issue in owner/repo with the caller's connected token. The
 * only write in this module -- used by POST /api/v3/scan/github-issue when a
 * user chooses to push a scan's findings to their repo. Title/body/labels are
 * built server-side from the scan; the token needs `repo` (or `public_repo`)
 * scope, which the connect flow requests (lib/github/github-oauth.ts).
 */
export async function createRepoIssue(
  token: string,
  owner: string,
  repo: string,
  issue: { title: string; body: string; labels?: string[] },
): Promise<CreatedIssue> {
  const res = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      title: issue.title,
      body: issue.body,
      ...(issue.labels?.length ? { labels: issue.labels } : {}),
    }),
  });
  if (!res.ok) {
    // 403 (no write scope / issues disabled), 404 (no access), 410 (issues off).
    throw new Error(`GitHub issue creation HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    number?: number;
    html_url?: string;
  };
  if (!data.number || !data.html_url) {
    throw new Error("GitHub issue creation did not return an issue reference.");
  }
  return { number: data.number, htmlUrl: data.html_url };
}

export interface GithubTreeEntry {
  path: string;
  /** Only "blob" entries (files) are ever scanned; "tree" (dirs) and "commit" (submodules) are skipped by the caller. */
  type: "blob" | "tree" | "commit";
  sha: string;
  /** Bytes. Present for blob entries. */
  size?: number;
}

export interface GithubTreeResult {
  entries: GithubTreeEntry[];
  /** True when GitHub itself truncated the listing (repo has more entries than the API returns in one call). */
  truncated: boolean;
}

/**
 * Fetches the full recursive file tree for `ref` (a branch name, tag, or
 * commit SHA — GitHub resolves any of these for this endpoint).
 */
export async function listRepoTree(
  token: string,
  owner: string,
  repo: string,
  ref: string,
): Promise<GithubTreeResult> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`GitHub tree fetch HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    tree?: Array<{
      path: string;
      type: string;
      sha: string;
      size?: number;
    }>;
    truncated?: boolean;
  };

  const entries: GithubTreeEntry[] = (data.tree ?? [])
    .filter(
      (e): e is GithubTreeEntry =>
        e.type === "blob" || e.type === "tree" || e.type === "commit",
    )
    .map((e) => ({
      path: e.path,
      type: e.type as GithubTreeEntry["type"],
      sha: e.sha,
      size: e.size,
    }));

  return { entries, truncated: Boolean(data.truncated) };
}

/**
 * Fetches one blob's content by SHA (as given by a tree entry) and
 * decodes it from base64. Returns null for content GitHub can't return
 * as base64 text (this only happens for the rare "too large" blob API
 * response) rather than throwing — callers treat that the same as a
 * skipped binary file.
 */
export async function getBlobContent(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  const res = await fetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) {
    throw new Error(`GitHub blob fetch HTTP ${res.status}`);
  }
  const data = (await res.json()) as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") return null;

  try {
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}
