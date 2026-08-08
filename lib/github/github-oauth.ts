/**
 * GitHub OAuth token exchange + user lookup for the repo-connect flow.
 *
 * Separate from any identity-only "Sign in with GitHub" OAuth: this
 * requests the `repo` scope (read+write access to public and private
 * repos) rather than an identity-only scope. Judgment call: classic
 * GitHub OAuth apps have no scope that grants read-ONLY access to private
 * repository contents — `public_repo` would be narrower but silently
 * excludes private repos from listing and reading entirely, which is not
 * what a user connecting "their GitHub account" expects. `repo`'s write
 * half is simply never exercised by this feature (every call this app
 * makes with the token is a GET). A GitHub App with fine-grained
 * `contents:read` permission would be the tighter alternative if this
 * needs revisiting later.
 */

export const GITHUB_CONNECT_SCOPE = "repo";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

export function buildGithubAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", GITHUB_CONNECT_SCOPE);
  url.searchParams.set("state", opts.state);
  return url.toString();
}

interface GithubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface GithubTokenResult {
  accessToken: string;
  /** Comma-separated scopes GitHub actually granted (may differ from what was requested). */
  scopes: string;
}

/**
 * Exchanges an OAuth `code` for an access token. Throws with a message
 * safe to log (never includes the code or the resulting token) on
 * failure.
 */
export async function exchangeGithubCode(opts: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GithubTokenResult> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub token exchange HTTP ${res.status}`);
  }

  const data = (await res.json()) as GithubTokenResponse;
  if (data.error || !data.access_token) {
    throw new Error(
      `GitHub token exchange failed: ${data.error ?? "no access_token in response"}`,
    );
  }

  return { accessToken: data.access_token, scopes: data.scope ?? "" };
}

export interface GithubUser {
  id: number;
  login: string;
}

/** Fetches the identity of the user who owns `accessToken`. */
export async function fetchGithubUser(
  accessToken: string,
): Promise<GithubUser> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub user lookup HTTP ${res.status}`);
  }

  const data = (await res.json()) as { id?: number; login?: string };
  if (typeof data.id !== "number" || typeof data.login !== "string") {
    throw new Error("GitHub user lookup returned an unexpected shape");
  }

  return { id: data.id, login: data.login };
}
