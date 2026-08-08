import pool from "@/lib/database/db";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";

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
}

export async function getGithubConnection(
  userId: number,
): Promise<GithubConnection | null> {
  const result = await pool.query(
    `SELECT github_user_id, github_username, scopes, connected_at, updated_at
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
  };
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
 * Upsert a connection. Called from the OAuth callback with a freshly
 * exchanged token — always replaces whatever was there (reconnecting
 * rotates the token and re-records whatever scope GitHub granted this
 * time).
 */
export async function saveGithubConnection(opts: {
  userId: number;
  githubUserId: number;
  githubUsername: string;
  accessToken: string;
  scopes: string;
}): Promise<void> {
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
}

export async function deleteGithubConnection(userId: number): Promise<boolean> {
  const result = await pool.query(
    "DELETE FROM github_connections WHERE user_id = $1",
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}
