import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

// GET /api/v3/account/discord - Get Discord connection status
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({
      connected: true,
      discordId: connection.discord_id,
      discordUsername: connection.discord_username,
      discordAvatar: connection.discord_avatar,
      guildJoined: connection.guild_joined,
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
