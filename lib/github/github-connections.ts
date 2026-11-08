import pool from "@/lib/database/db";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";
import { logError } from "@/lib/logging/log";
import { GITHUB_FETCH_TIMEOUT_MS } from "@/lib/github/github-api";

/**
 * DB access for the `github_connections` table (account-linked GitHub
 * OAuth, repo-read scope). Mirrors the shape of lib/discord/discord-utils.ts:
 * tokens are encrypted at rest with the same AES-256-GCM helper
 * (lib/auth/crypto.ts) already used for discord_connections.access_token
 * and user_ai_configs.api_key_encrypted.
 */

export interface GithubConnection {
  githubUserId: number;
  githubUsername: string;
  scopes: string;
  connectedAt: Date;
  updatedAt: Date;
  /** Repo full names ("owner/repo") the user has curated into their working
   *  set via the repo picker modal. Empty until they've made a selection. */
  selectedRepos: string[];
}

export async function getGithubConnection(
  userId: number,
): Promise<GithubConnection | null> {
  const result = await pool.query(
    `SELECT github_user_id, github_username, scopes, connected_at, updated_at, selected_repos
     FROM github_connections WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    githubUserId: Number(row.github_user_id),
    githubUsername: row.github_username,
    scopes: row.scopes,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
    // jsonb comes back already parsed by pg; default defensively in case an
    // older row somehow has a null there.
    selectedRepos: Array.isArray(row.selected_repos) ? row.selected_repos : [],
  };
}

/**
 * Persist the curated set of repos the user wants showing up in the
 * Developer tab's list, replacing whatever was saved before. Called from
 * the repo picker modal's confirm action (both the first-time "Load
 * repositories" flow and the later "Edit selection" flow).
 *
 * Returns false if there is no connection row to update (e.g. the user
 * disconnected in another tab right before this landed).
 */
export async function saveSelectedRepos(
  userId: number,
  repoFullNames: string[],
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE github_connections
     SET selected_repos = $2::jsonb, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify(repoFullNames)],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Fetch and decrypt the stored GitHub access token for a user. Returns
 * null if there is no connection, throws on a decrypt failure (indicates
 * key rotation / corruption / tampering — same contract as
 * lib/discord/discord-utils.ts's getDiscordTokens).
 */
export async function getDecryptedGithubToken(
  userId: number,
): Promise<string | null> {
  const result = await pool.query(
    "SELECT access_token_encrypted FROM github_connections WHERE user_id = $1",
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return decryptApiKey(row.access_token_encrypted as string);
}

/**
 * Tells GitHub a token is finished with. Best effort: the caller is removing
 * the connection or the account either way, so a failure is logged and never
 * thrown. Revokes this one token rather than the whole grant, because the same
 * OAuth app also signs the user in.
 */
async function revokeGithubToken(userId: number, token: string): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logError(
      "github",
      "could not revoke a GitHub token: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET are not set",
      undefined,
      { userId },
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.github.com/applications/${encodeURIComponent(clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "Content-Type": "application/json",
          "User-Agent": "VulnRadar",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ access_token: token }),
        signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
      },
    );
    // 404 is GitHub saying the token is already gone, which is the goal.
    if (!response.ok && response.status !== 404) {
      logError("github", "GitHub refused the token revocation", undefined, {
        userId,
        status: response.status,
      });
    }
  } catch (error) {
    logError("github", "could not revoke a GitHub token", error, { userId });
  }
}

/** Decrypted token from the row, or null when there is none to act on. */
async function readTokenForRevocation(userId: number): Promise<string | null> {
  try {
    return await getDecryptedGithubToken(userId);
  } catch (error) {
    logError("github", "could not read a GitHub token to revoke", error, {
      userId,
    });
    return null;
  }
}

/**
 * Revokes the stored token at GitHub. The row is the only copy of the token, so
 * this has to run before anything deletes it: a `repo` token can write to every
 * repository the account reaches, and it stays valid until GitHub is told.
 */
export async function revokeStoredGithubToken(userId: number): Promise<void> {
  const token = await readTokenForRevocation(userId);
  if (token) await revokeGithubToken(userId, token);
}

/**
 * Upsert a connection. Called from the OAuth callback with a freshly
 * exchanged token — always replaces whatever was there (reconnecting
 * rotates the token and re-records whatever scope GitHub granted this
 * time).
 *
 * The token being replaced is revoked only after the new one is stored: a
 * failed write (this GitHub account belongs to someone else) has to leave the
 * existing connection working. GitHub can also hand the same token back on a
 * re-authorization, and revoking that would kill what was just saved.
 */
export async function saveGithubConnection(opts: {
  userId: number;
  githubUserId: number;
  githubUsername: string;
  accessToken: string;
  scopes: string;
}): Promise<void> {
  const previous = await readTokenForRevocation(opts.userId);
  const encrypted = encryptApiKey(opts.accessToken);
  await pool.query(
    `INSERT INTO github_connections
       (user_id, github_user_id, github_username, access_token_encrypted, scopes, connected_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       github_user_id = $2,
       github_username = $3,
       access_token_encrypted = $4,
       scopes = $5,
       updated_at = NOW()`,
    [
      opts.userId,
      opts.githubUserId,
      opts.githubUsername,
      encrypted,
      opts.scopes,
    ],
  );
  if (previous && previous !== opts.accessToken) {
    await revokeGithubToken(opts.userId, previous);
  }
}

export async function deleteGithubConnection(userId: number): Promise<boolean> {
  await revokeStoredGithubToken(userId);
  const result = await pool.query(
    "DELETE FROM github_connections WHERE user_id = $1",
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}
