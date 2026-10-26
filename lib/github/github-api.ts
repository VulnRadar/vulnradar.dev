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

/**
 * How long any one GitHub request may take, body included. None of these calls
 * had a limit, so GitHub accepting the connection and then not answering held
 * the caller for as long as undici's own header and body timeouts allowed,
 * which is minutes, with a user waiting on a page or a scan behind it. The
 * signal runs until the body has been read, so a response that starts and then
 * stalls is cut off too.
 */
export const GITHUB_FETCH_TIMEOUT_MS = 10_000;

function githubFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
  });
}

/** AbortSignal.timeout() rejects with a DOMException named TimeoutError. */
export function isGithubTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
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

    const res = await githubFetch(url.toString(), {
      headers: authHeaders(token),
    });
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

// Letters, digits, dot, underscore and hyphen are every character GitHub
// allows in an owner or repo name. Anything else is not a repo, and "." or ".."
// would be normalised out of the request path by URL parsing and turn a
// lookup into a request for some other api.github.com endpoint.
const REPO_NAME_PART_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 403 is also how GitHub answers a request it is rate limiting, which must not
 * be read as "this repo is not available to you".
 */
function isRateLimited(res: Response): boolean {
  return (
    res.status === 429 ||
    res.headers.get("x-ratelimit-remaining") === "0" ||
    res.headers.has("retry-after")
  );
}

/**
 * One repo by its "owner/name", or null when it is not there for this token any
 * more: deleted, renamed or transferred away, taken down, or behind an org's
 * SSO or access policy. That is the same set listUserRepos leaves out of its
 * answer, so a selected repo that has gone away drops off the working set
 * instead of failing it. Anything else that goes wrong throws.
 */
async function getRepoSummary(
  token: string,
  fullName: string,
): Promise<GithubRepoSummary | null> {
  const [owner, repo, ...extra] = fullName.split("/");
  if (
    !owner ||
    !repo ||
    extra.length > 0 ||
    !REPO_NAME_PART_RE.test(owner) ||
    !REPO_NAME_PART_RE.test(repo) ||
    /^\.+$/.test(owner) ||
    /^\.+$/.test(repo)
  ) {
    return null;
  }

  const res = await githubFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
    headers: authHeaders(token),
  });
  if (res.status === 404 || res.status === 410 || res.status === 451) {
    return null;
  }
  if (res.status === 403 && !isRateLimited(res)) return null;
  if (!res.ok) {
    throw new Error(`GitHub repo lookup HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    full_name: string;
    private: boolean;
    default_branch: string;
    updated_at: string;
    description: string | null;
  };
  // A renamed or transferred repo is answered with a redirect to its new name.
  // The saved selection still names the old one, so the new name would show up
  // as a repo nobody picked and the scan history, which is keyed by the old
  // name, would not line up with it. listUserRepos never matched these either.
  if (data.full_name.toLowerCase() !== fullName.toLowerCase()) return null;

  return {
    fullName: data.full_name,
    private: data.private,
    defaultBranch: data.default_branch,
    updatedAt: data.updated_at,
    description: data.description,
  };
}

// A selection can run to 300 repos. Eight at a time keeps that to a few dozen
// short rounds without opening three hundred sockets at once.
const REPO_LOOKUP_CONCURRENCY = 8;

/**
 * Looks up just the named repos, in the order given, skipping any that are no
 * longer available. This is what the /repos page renders its working set from:
 * it already knows the names (github_connections.selected_repos), so asking for
 * the account's whole repo list (up to three serial pages of a hundred) only to
 * throw most of it away was the slow part of every visit. A repo that fails for
 * any reason other than being gone fails the whole call, because a quietly
 * shorter list would read as "you removed these".
 */
export async function getReposByFullName(
  token: string,
  fullNames: string[],
): Promise<GithubRepoSummary[]> {
  const found: (GithubRepoSummary | null)[] = fullNames.map(() => null);
  let cursor = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && cursor < fullNames.length) {
      const index = cursor++;
      try {
        found[index] = await getRepoSummary(token, fullNames[index]);
      } catch (err) {
        // Stops the other workers taking new names; their requests already in
        // flight finish or time out on their own.
        failed = true;
        throw err;
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(REPO_LOOKUP_CONCURRENCY, fullNames.length) },
      worker,
    ),
  );
  return found.filter((repo): repo is GithubRepoSummary => repo !== null);
}

// One lookup per repo against listUserRepos's one to three requests: past this
// many names the listing is the cheaper way to resolve them. It matters for
// more than speed. These calls spend the account's GitHub rate limit (5,000 an
// hour), the same budget a scan draws on, and a selection can run to 300.
const LOOKUP_LIMIT = 30;

/**
 * The details of a saved selection, in the order it was saved, with any repo
 * that is no longer available left out. A short selection is looked up name by
 * name, which is what keeps the /repos page from listing the whole account to
 * show a handful of repos; a long one falls back to the listing, because
 * hundreds of single lookups on every visit would cost more than the listing
 * it replaced, in time and in rate limit.
 */
export async function getSelectedRepos(
  token: string,
  fullNames: string[],
): Promise<GithubRepoSummary[]> {
  if (fullNames.length <= LOOKUP_LIMIT) {
    return getReposByFullName(token, fullNames);
  }
  const listed = new Map(
    (await listUserRepos(token)).map((repo) => [
      repo.fullName.toLowerCase(),
      repo,
    ]),
  );
  return fullNames.flatMap((name) => {
    const repo = listed.get(name.toLowerCase());
    return repo ? [repo] : [];
  });
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
  const res = await githubFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, {
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
  const res = await githubFetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        ...(issue.labels?.length ? { labels: issue.labels } : {}),
      }),
    },
  );
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
  const res = await githubFetch(
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
  const res = await githubFetch(
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
