import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { deleteAvatarFilesIfLocal } from "@/lib/uploads/avatar-storage";
import { decryptApiKey } from "@/lib/auth/crypto";

/**
 * Re-checks guild membership live via the bot token (a GET, needs no user
 * token and so is unaffected by the stored OAuth access token expiring)
 * instead of trusting guild_joined's value from whenever the account was
 * first connected -- that snapshot never updated again on its own, so
 * someone who joined the server after connecting (or whose original join
 * attempt failed for a since-resolved reason) stayed marked "not in
 * server" forever. If they're still not a member, opportunistically
 * retries the join (a PUT, which does need the stored access token) --
 * best-effort only: an expired token just means this attempt is skipped,
 * not an error surfaced to the page.
 */
async function refreshGuildMembership(
  userId: number,
  discordId: string,
  storedGuildJoined: boolean,
  encryptedAccessToken: string,
): Promise<boolean> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) {
    console.log(
      "[Discord] Skipping live guild check: DISCORD_BOT_TOKEN/DISCORD_GUILD_ID not configured on this server.",
    );
    return storedGuildJoined;
  }

  let guildJoined = storedGuildJoined;
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
        const accessToken = decryptApiKey(encryptedAccessToken);
        const joinRes = await fetch(
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
        guildJoined = joinRes.ok || joinRes.status === 204;
        if (!guildJoined) {
          const body = await joinRes.text().catch(() => "");
          console.error(
            `[Discord] Auto-join failed with HTTP ${joinRes.status}: ${body}. ` +
              `Common causes: the OAuth token was granted without the "guilds.join" ` +
              `scope, or the bot account isn't a member of guild ${guildId} with ` +
              `Create Instant Invite permission.`,
          );
        }
      } catch (err) {
        console.error("[Discord] Opportunistic auto-join threw:", err);
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
    return storedGuildJoined;
  }

  if (guildJoined !== storedGuildJoined) {
    await pool.query(
      `UPDATE discord_connections SET guild_joined = $1, updated_at = NOW() WHERE user_id = $2`,
      [guildJoined, userId],
    );
  }
  return guildJoined;
}

// GET /api/v3/account/discord - Get Discord connection status
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT discord_id, discord_username, discord_avatar, guild_joined, updated_at, access_token
       FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ connected: false });
    }

    const connection = result.rows[0];
    const guildJoined = await refreshGuildMembership(
      session.userId,
      connection.discord_id,
      connection.guild_joined,
      connection.access_token,
    );

    return NextResponse.json({
      connected: true,
      discordId: connection.discord_id,
      discordUsername: connection.discord_username,
      discordAvatar: connection.discord_avatar,
      guildJoined,
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
