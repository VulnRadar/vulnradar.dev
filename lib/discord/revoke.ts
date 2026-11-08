import pool from "@/lib/database/db";
import { decryptApiKey } from "@/lib/auth/crypto";
import { logError } from "@/lib/logging/log";

/**
 * Tells Discord that a stored authorization is finished with.
 *
 * Deleting discord_connections only deletes our copy: the refresh token beside
 * it stayed valid at Discord, so "disconnected" was only ever true on this
 * side. Best effort by design, here and in lib/github/github-connections.ts.
 * Callers are removing a connection or an account, and a Discord outage must
 * not stop either. A failure is logged, never thrown.
 */

const DISCORD_REVOKE_URL = "https://discord.com/api/oauth2/token/revoke";

/** Account deletion waits on this, so an unresponsive Discord has to end. */
const DISCORD_REVOKE_TIMEOUT_MS = 8_000;

/** The two discord_connections columns, still encrypted. */
export interface StoredDiscordTokens {
  accessToken: string | null;
  refreshToken: string | null;
}

async function revokeOne(
  userId: number,
  encrypted: string,
  hint: "access_token" | "refresh_token",
  authorization: string,
): Promise<void> {
  try {
    const response = await fetch(DISCORD_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: authorization,
      },
      body: new URLSearchParams({
        token: decryptApiKey(encrypted),
        token_type_hint: hint,
      }),
      signal: AbortSignal.timeout(DISCORD_REVOKE_TIMEOUT_MS),
    });
    if (!response.ok) {
      logError("discord", "Discord refused the token revocation", undefined, {
        userId,
        hint,
        status: response.status,
      });
    }
  } catch (error) {
    logError("discord", "could not revoke a Discord token", error, {
      userId,
      hint,
    });
  }
}

export async function revokeDiscordTokens(
  userId: number,
  tokens: StoredDiscordTokens,
): Promise<void> {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logError(
      "discord",
      "could not revoke Discord tokens: DISCORD_CLIENT_ID/DISCORD_CLIENT_SECRET are not set",
      undefined,
      { userId },
    );
    return;
  }

  const authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  await Promise.all([
    tokens.accessToken
      ? revokeOne(userId, tokens.accessToken, "access_token", authorization)
      : undefined,
    tokens.refreshToken
      ? revokeOne(userId, tokens.refreshToken, "refresh_token", authorization)
      : undefined,
  ]);
}

/** Reads the connection row and revokes what it holds, if there is one. */
export async function revokeStoredDiscordTokens(userId: number): Promise<void> {
  try {
    const result = await pool.query<{
      access_token: string | null;
      refresh_token: string | null;
    }>(
      "SELECT access_token, refresh_token FROM discord_connections WHERE user_id = $1",
      [userId],
    );
    const row = result.rows[0];
    if (!row) return;
    await revokeDiscordTokens(userId, {
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
    });
  } catch (error) {
    logError("discord", "could not read Discord tokens to revoke", error, {
      userId,
    });
  }
}
