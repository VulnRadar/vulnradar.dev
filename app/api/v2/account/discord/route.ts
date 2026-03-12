import pool from "@/lib/db"
import { authMiddleware } from "@/lib/auth-middleware"
import { ApiResponse } from "@/lib/api-utils"
import { NextResponse } from "next/server"

export const DELETE = authMiddleware(async (req, session) => {
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

    return ApiResponse.success({ message: "Discord account disconnected" })
  } catch (error) {
    console.error("Discord disconnect error:", error)
    return ApiResponse.internalError("Failed to disconnect Discord account")
  }
})
