import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"

// GET /api/v2/account/discord - Get Discord connection status
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await pool.query(
      `SELECT discord_id, discord_username, discord_avatar, guild_joined, updated_at 
       FROM discord_connections WHERE user_id = $1`,
      [session.userId]
    )

    if (!result.rows[0]) {
      return NextResponse.json({ connected: false })
    }

    const connection = result.rows[0]
    return NextResponse.json({
      connected: true,
      discordId: connection.discord_id,
      discordUsername: connection.discord_username,
      discordAvatar: connection.discord_avatar,
      guildJoined: connection.guild_joined,
      updatedAt: connection.updated_at,
    })
  } catch (error) {
    console.error("Discord connection check error:", error)
    return NextResponse.json({ error: "Failed to check Discord connection" }, { status: 500 })
  }
}

// DELETE /api/v2/account/discord - Disconnect Discord account
export async function DELETE() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get current Discord connection
    const discordResult = await pool.query(
      `SELECT id FROM discord_connections WHERE user_id = $1`,
      [session.userId]
    )

    if (!discordResult.rows[0]) {
      return NextResponse.json(
        { error: "No Discord connection found" },
        { status: 404 }
      )
    }

    // Delete Discord connection
    await pool.query(
      `DELETE FROM discord_connections WHERE user_id = $1`,
      [session.userId]
    )

    // Clear discord_id from user
    await pool.query(
      `UPDATE users SET discord_id = NULL WHERE id = $1`,
      [session.userId]
    )

    return NextResponse.json({ success: true, message: "Discord account disconnected" })
  } catch (error) {
    console.error("Discord disconnect error:", error)
    return NextResponse.json({ error: "Failed to disconnect Discord account" }, { status: 500 })
  }
}
