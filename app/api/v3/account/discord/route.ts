import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse } from "@/lib/api/api-utils";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { decryptApiKey } from "@/lib/auth/crypto";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import { revokeDiscordTokens } from "@/lib/discord/revoke";
import {
  DiscordReauthRequiredError,
  refreshDiscordAccessToken,
} from "@/lib/discord/discord-utils";

/** What a join attempt concluded, plus whether the stored authorization is
 *  dead and only the user can fix it. */
interface GuildMembership {
  guildJoined: boolean;
  /** Discord refused the refresh token: the user revoked the app, or the
   *  refresh token expired. The page says so instead of showing a silent
   *  "not in server" that no amount of waiting will change. */
  reauthRequired: boolean;
}

/** An access token this close to expiry is not worth spending a request on:
 *  refresh it before the join rather than after the rejection. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** How long after connecting the "sync your profile" dialog may still open. */
const PROFILE_SYNC_WINDOW_MS = 5 * 60_000;

function timestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === "string" ? Date.parse(value) : NaN;
}

function accessTokenExpired(tokenExpiresAt: unknown): boolean {
  const expiry = timestampMs(tokenExpiresAt);
  if (Number.isNaN(expiry)) return false;
  return expiry <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
}

/** updated_at rather than connected_at: reconnecting keeps the first date but
 *  is just as much a moment to offer the sync. */
function connectedJustNow(updatedAt: unknown): boolean {
  const at = timestampMs(updatedAt);
  return !Number.isNaN(at) && Date.now() - at < PROFILE_SYNC_WINDOW_MS;
}

function discordAvatarUrl(discordId: string, avatarHash: string): string {
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png?size=256`;
}

/** Discord rejects a stale user token on the join PUT with a 401, or with a
 *  400 carrying error code 50025 ("Invalid OAuth2 access token"). Either one
 *  means "the token, not the request" and is worth one refresh. */
function isAccessTokenRejected(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status !== 400) return false;
  return /50025|invalid[ _]oauth2?[ _]access[ _]token/i.test(body);
}

async function attemptGuildJoin(
  guildId: string,
  botToken: string,
  discordId: string,
  accessToken: string,
): Promise<{ joined: boolean; status: number; body: string }> {
  const res = await fetch(
    `https://discord.com/api/guilds/${guildId}/members/${discordId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    },
  );
  if (res.ok || res.status === 204) {
    return { joined: true, status: res.status, body: "" };
  }
  const body = await res.text().catch(() => "");
  return { joined: false, status: res.status, body };
}

/**
 * Re-checks guild membership live via the bot token (a GET, needs no user
 * token and so is unaffected by the stored OAuth access token expiring)
 * instead of trusting guild_joined's value from whenever the account was
 * first connected -- that snapshot never updated again on its own.
 *
 * Read-only as far as Discord is concerned. This used to PUT anyone it found
 * outside the server straight back in, spending the refresh token to do it, so
 * opening the Social tab undid leaving and the only way out was to disconnect
 * entirely. Joining is POST below and the connect callback, nothing else.
 */
async function checkGuildMembership(
  userId: number,
  discordId: string,
  storedGuildJoined: boolean,
): Promise<boolean> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return storedGuildJoined;

  let guildJoined = storedGuildJoined;
  try {
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (memberRes.status === 200) {
      guildJoined = true;
    } else if (memberRes.status === 404) {
      guildJoined = false;
    } else {
      // Anything other than 200/404 (401 bad bot token, 403 bot lacks
      // access to this guild, etc.) -- log the body so the real cause is
      // visible instead of silently falling back to the stored value.
      const body = await memberRes.text().catch(() => "");
      console.error(
        `[Discord] Guild member lookup returned unexpected HTTP ${memberRes.status}: ${body}. ` +
          `Common causes: DISCORD_BOT_TOKEN is wrong/revoked, or the bot account was never ` +
          `added to guild ${guildId}.`,
      );
    }
  } catch (err) {
    console.error("[Discord] Live guild membership check request failed:", err);
    return storedGuildJoined;
  }

  if (guildJoined !== storedGuildJoined) {
    await recordGuildJoined(userId, guildJoined);
  }
  return guildJoined;
}

/** Leaves updated_at alone: it is what the page prints as "Connected" and what
 *  says the connection was made just now, and a membership change is neither. */
async function recordGuildJoined(
  userId: number,
  guildJoined: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE discord_connections SET guild_joined = $1 WHERE user_id = $2`,
    [guildJoined, userId],
  );
}

/**
 * Adds the member to the server. Needs the stored user access token, which
 * Discord expires after 7 days, so the refresh token beside it is spent here:
 * refreshed up front when the stored token has already expired, and refreshed
 * once in response to Discord rejecting it, followed by exactly one retry.
 * Never more than that, and a refresh Discord itself refuses is reported rather
 * than swallowed.
 */
async function joinGuild(
  guildId: string,
  botToken: string,
  userId: number,
  discordId: string,
  encryptedAccessToken: string,
  tokenExpiresAt: unknown,
): Promise<GuildMembership> {
  try {
    let accessToken = decryptApiKey(encryptedAccessToken);
    // One refresh budget for this request, spent either up front (the
    // stored token is already past its expiry) or reactively (Discord
    // rejected it). Once spent, a second rejection is a real failure.
    let refreshAvailable = true;

    if (accessTokenExpired(tokenExpiresAt)) {
      accessToken = await refreshDiscordAccessToken(userId);
      refreshAvailable = false;
    }

    let attempt = await attemptGuildJoin(
      guildId,
      botToken,
      discordId,
      accessToken,
    );

    if (
      !attempt.joined &&
      refreshAvailable &&
      isAccessTokenRejected(attempt.status, attempt.body)
    ) {
      accessToken = await refreshDiscordAccessToken(userId);
      attempt = await attemptGuildJoin(
        guildId,
        botToken,
        discordId,
        accessToken,
      );
    }

    if (!attempt.joined) {
      console.error(
        `[Discord] Join failed with HTTP ${attempt.status}: ${attempt.body}. ` +
          `Common causes: the OAuth token was granted without the "guilds.join" ` +
          `scope, or the bot account isn't a member of guild ${guildId} with ` +
          `Create Instant Invite permission.`,
      );
    }
    return { guildJoined: attempt.joined, reauthRequired: false };
  } catch (err) {
    if (err instanceof DiscordReauthRequiredError) {
      // Terminal: only the user can fix this, so say so on the page
      // rather than leaving them on a permanent "not in server".
      return { guildJoined: false, reauthRequired: true };
    }
    console.error("[Discord] Join threw:", err);
    return { guildJoined: false, reauthRequired: false };
  }
}

// GET /api/v3/account/discord - Get Discord connection status
export async function GET() {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }

  try {
    const result = await pool.query(
      `SELECT discord_id, discord_username, discord_avatar, guild_joined, updated_at
       FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ connected: false });
    }

    const connection = result.rows[0];
    const guildJoined = await checkGuildMembership(
      session.userId,
      connection.discord_id,
      connection.guild_joined,
    );

    return NextResponse.json({
      connected: true,
      discordId: connection.discord_id,
      discordUsername: connection.discord_username,
      discordAvatar: connection.discord_avatar,
      avatarUrl: connection.discord_avatar
        ? discordAvatarUrl(connection.discord_id, connection.discord_avatar)
        : null,
      guildJoined,
      // Whether "Join server" can do anything on this deployment.
      canJoin: Boolean(
        process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID,
      ),
      // Only a join can discover a dead authorization (see POST), and this
      // route no longer attempts one. Kept so the response keeps its shape.
      reauthRequired: false,
      // Whether the post-connect sync dialog may open, decided on this clock
      // rather than the browser's.
      justConnected: connectedJustNow(connection.updated_at),
      updatedAt: connection.updated_at,
    });
  } catch (error) {
    console.error("Discord connection check error:", error);
    return NextResponse.json(
      { error: "Failed to check Discord connection" },
      { status: 500 },
    );
  }
}

// POST /api/v3/account/discord - Join the server, on the member's explicit ask
export async function POST() {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }
  const refused = refuseWhileImpersonating(
    session,
    "Joining the Discord server",
  );
  if (refused) return refused;

  try {
    const result = await pool.query(
      `SELECT discord_id, guild_joined, access_token, token_expires_at
       FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );
    const connection = result.rows[0];
    if (!connection) {
      return NextResponse.json(
        { error: "No Discord connection found" },
        { status: 404 },
      );
    }

    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;
    if (!botToken || !guildId) {
      return NextResponse.json(
        { error: "This VulnRadar server has no Discord bot set up." },
        { status: 503 },
      );
    }

    const { guildJoined, reauthRequired } = await joinGuild(
      guildId,
      botToken,
      session.userId,
      connection.discord_id,
      connection.access_token,
      connection.token_expires_at,
    );
    if (guildJoined !== connection.guild_joined) {
      await recordGuildJoined(session.userId, guildJoined);
    }

    if (!guildJoined && !reauthRequired) {
      return NextResponse.json(
        {
          error: "Discord would not add you to the server. Try again shortly.",
          guildJoined,
          reauthRequired,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ guildJoined, reauthRequired });
  } catch (error) {
    console.error("Discord join error:", error);
    return NextResponse.json(
      { error: "Failed to join the Discord server" },
      { status: 500 },
    );
  }
}

// PATCH /api/v3/account/discord - Sync avatar/name from connected Discord account
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }

  let body: { syncAvatar?: boolean; syncName?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { syncAvatar, syncName } = body;
  if (!syncAvatar && !syncName) {
    return NextResponse.json({ success: true, updated: [] });
  }

  try {
    const conn = await pool.query(
      `SELECT discord_id, discord_username, discord_avatar FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );
    if (!conn.rows[0]) {
      return NextResponse.json(
        { error: "No Discord connection found." },
        { status: 404 },
      );
    }

    const { discord_id, discord_username, discord_avatar } = conn.rows[0];
    const sets: string[] = [];
    const vals: unknown[] = [];
    const updated: string[] = [];

    if (syncAvatar && discord_avatar) {
      sets.push(`avatar_url = $${sets.length + 1}`);
      vals.push(discordAvatarUrl(discord_id, discord_avatar));
      updated.push("avatar");
      // Switching to an external Discord avatar: drop any previously
      // uploaded local file so it doesn't linger as an orphan.
      await deleteAvatarFilesIfLocal(session.userId);
    }
    if (syncName && discord_username) {
      sets.push(`name = $${sets.length + 1}`);
      vals.push(discord_username);
      updated.push("name");
    }

    if (sets.length > 0) {
      vals.push(session.userId);
      await pool.query(
        `UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length}`,
        vals,
      );
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error("Discord sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync Discord profile." },
      { status: 500 },
    );
  }
}

// DELETE /api/v3/account/discord - Disconnect Discord account
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized();
  }
  const refused = refuseWhileImpersonating(
    session,
    "Disconnecting a sign-in provider",
  );
  if (refused) return refused;

  try {
    // Get current Discord connection
    const discordResult = await pool.query(
      `SELECT id FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );

    if (!discordResult.rows[0]) {
      return NextResponse.json(
        { error: "No Discord connection found" },
        { status: 404 },
      );
    }

    const client = await pool.connect();
    let tokens: { access_token: string | null; refresh_token: string | null };
    try {
      await client.query("BEGIN");
      // Same rule as /account/oauth/[provider], which counts Discord as the
      // way back in: never leave an account with nothing to sign in with. The
      // check lives in the WHERE so that a concurrent Google or GitHub
      // disconnect is re-read under the row lock instead of both passing.
      const cleared = await client.query(
        `UPDATE users SET discord_id = NULL
         WHERE id = $1
           AND (password_hash IS NOT NULL OR google_id IS NOT NULL OR github_id IS NOT NULL)
         RETURNING id`,
        [session.userId],
      );
      if ((cleared.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "Discord is your only way to sign in. Set a password or connect another account first.",
          },
          { status: 400 },
        );
      }

      const removed = await client.query(
        `DELETE FROM discord_connections WHERE user_id = $1
         RETURNING access_token, refresh_token`,
        [session.userId],
      );
      tokens = removed.rows[0] ?? { access_token: null, refresh_token: null };
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // After the commit, never while the row lock is held, and only once it is
    // certain the connection is going: a refused disconnect keeps its tokens.
    await revokeDiscordTokens(session.userId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    return NextResponse.json({
      success: true,
      message: "Discord account disconnected",
    });
  } catch (error) {
    console.error("Discord disconnect error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect Discord account" },
      { status: 500 },
    );
  }
}
