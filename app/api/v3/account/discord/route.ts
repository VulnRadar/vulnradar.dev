import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { decryptApiKey } from "@/lib/auth/crypto";
import {
  DiscordReauthRequiredError,
  refreshDiscordAccessToken,
} from "@/lib/discord/discord-utils";

/** What the live membership check concluded, plus whether the stored
 *  authorization is dead and only the user can fix it. */
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

function accessTokenExpired(tokenExpiresAt: unknown): boolean {
  const expiry =
    tokenExpiresAt instanceof Date
      ? tokenExpiresAt.getTime()
      : typeof tokenExpiresAt === "string"
        ? Date.parse(tokenExpiresAt)
        : NaN;
  if (Number.isNaN(expiry)) return false;
  return expiry <= Date.now() + TOKEN_EXPIRY_SKEW_MS;
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
 * first connected -- that snapshot never updated again on its own, so
 * someone who joined the server after connecting (or whose original join
 * attempt failed for a since-resolved reason) stayed marked "not in
 * server" forever. If they're still not a member, retries the join (a PUT,
 * which does need the stored access token).
 *
 * Discord expires that access token after 7 days, so the join used to work
 * only for accounts connected within the last week and then fail silently
 * forever. The refresh token beside it was stored, encrypted and re-encrypted
 * on key rotation, and never spent. It is spent here: refreshed up front when
 * the stored token has already expired, and refreshed once in response to
 * Discord rejecting it, followed by exactly one retry. Never more than that,
 * and a refresh Discord itself refuses is reported rather than swallowed.
 */
async function refreshGuildMembership(
  userId: number,
  discordId: string,
  storedGuildJoined: boolean,
  encryptedAccessToken: string,
  tokenExpiresAt: unknown,
): Promise<GuildMembership> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) {
    console.log(
      "[Discord] Skipping live guild check: DISCORD_BOT_TOKEN/DISCORD_GUILD_ID not configured on this server.",
    );
    return { guildJoined: storedGuildJoined, reauthRequired: false };
  }

  let guildJoined = storedGuildJoined;
  let reauthRequired = false;
  try {
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } },
    );
    if (memberRes.status === 200) {
      guildJoined = true;
    } else if (memberRes.status === 404) {
      console.log(
        `[Discord] User ${discordId} is not a member of guild ${guildId} yet -- attempting auto-join.`,
      );
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

        guildJoined = attempt.joined;
        if (!guildJoined) {
          console.error(
            `[Discord] Auto-join failed with HTTP ${attempt.status}: ${attempt.body}. ` +
              `Common causes: the OAuth token was granted without the "guilds.join" ` +
              `scope, or the bot account isn't a member of guild ${guildId} with ` +
              `Create Instant Invite permission.`,
          );
        }
      } catch (err) {
        if (err instanceof DiscordReauthRequiredError) {
          // Terminal: only the user can fix this, so say so on the page
          // rather than leaving them on a permanent "not in server".
          reauthRequired = true;
        } else {
          console.error("[Discord] Opportunistic auto-join threw:", err);
        }
        guildJoined = false;
      }
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
    return { guildJoined: storedGuildJoined, reauthRequired: false };
  }

  if (guildJoined !== storedGuildJoined) {
    await pool.query(
      `UPDATE discord_connections SET guild_joined = $1, updated_at = NOW() WHERE user_id = $2`,
      [guildJoined, userId],
    );
  }
  return { guildJoined, reauthRequired };
}

// GET /api/v3/account/discord - Get Discord connection status
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT discord_id, discord_username, discord_avatar, guild_joined, updated_at, access_token, token_expires_at
       FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ connected: false });
    }

    const connection = result.rows[0];
    const { guildJoined, reauthRequired } = await refreshGuildMembership(
      session.userId,
      connection.discord_id,
      connection.guild_joined,
      connection.access_token,
      connection.token_expires_at,
    );

    return NextResponse.json({
      connected: true,
      discordId: connection.discord_id,
      discordUsername: connection.discord_username,
      discordAvatar: connection.discord_avatar,
      guildJoined,
      // True only when Discord itself refused the stored refresh token, i.e.
      // the authorization was revoked or expired outright. The page turns
      // this into "reconnect", which is the only thing that fixes it.
      reauthRequired,
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

// PATCH /api/v3/account/discord - Sync avatar/name from connected Discord account
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      const avatarUrl = `https://cdn.discordapp.com/avatars/${discord_id}/${discord_avatar}.png?size=256`;
      sets.push(`avatar_url = $${sets.length + 1}`);
      vals.push(avatarUrl);
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    // Delete Discord connection
    await pool.query(`DELETE FROM discord_connections WHERE user_id = $1`, [
      session.userId,
    ]);

    // Clear discord_id from user
    await pool.query(`UPDATE users SET discord_id = NULL WHERE id = $1`, [
      session.userId,
    ]);

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
