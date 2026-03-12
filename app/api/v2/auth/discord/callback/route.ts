// ============================================================================
// Discord OAuth Callback - Handle OAuth response
// ============================================================================

import { NextResponse } from "next/server"
import { getSession, createSession } from "@/lib/auth"
import pool from "@/lib/db"
import { cookies } from "next/headers"
import crypto from "crypto"
import { loadConfig } from "@/lib/config"

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

interface DiscordTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
}

interface DiscordUser {
  id: string
  username: string
  discriminator: string
  avatar: string | null
  email?: string
  verified?: boolean
}

// GET /api/v2/auth/discord/callback - Handle OAuth callback
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")
  const state = searchParams.get("state")
  const error = searchParams.get("error")

  // Get base URL from config or request
  const config = loadConfig()
  const baseUrl = config.app?.url || new URL(request.url).origin
  const redirectUri = `${baseUrl}/api/v2/auth/discord/callback`

  // Handle errors from Discord
  if (error) {
    return NextResponse.redirect(`${baseUrl}/login?error=discord_denied`)
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=discord_invalid`)
  }

  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return NextResponse.redirect(`${baseUrl}/login?error=discord_not_configured`)
  }

  // Parse state to get action
  let action = "connect"
  try {
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString())
    action = stateData.action || "connect"
    // Check if state is too old (5 minutes)
    if (Date.now() - stateData.ts > 5 * 60 * 1000) {
      return NextResponse.redirect(`${baseUrl}/login?error=discord_expired`)
    }
  } catch {
    return NextResponse.redirect(`${baseUrl}/login?error=discord_invalid_state`)
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenResponse.ok) {
      console.error("[Discord] Token exchange failed:", await tokenResponse.text())
      return NextResponse.redirect(`${baseUrl}/login?error=discord_token_failed`)
    }

    const tokens: DiscordTokenResponse = await tokenResponse.json()

    // Get Discord user info
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })

    if (!userResponse.ok) {
      console.error("[Discord] User fetch failed:", await userResponse.text())
      return NextResponse.redirect(`${baseUrl}/login?error=discord_user_failed`)
    }

    const discordUser: DiscordUser = await userResponse.json()

    // Calculate token expiry
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    // Try to auto-join Discord server if configured
    let guildJoined = false
    if (DISCORD_BOT_TOKEN && DISCORD_GUILD_ID) {
      try {
        const joinResponse = await fetch(
          `https://discord.com/api/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ access_token: tokens.access_token }),
          }
        )
        guildJoined = joinResponse.ok || joinResponse.status === 204
      } catch (e) {
        console.error("[Discord] Guild join failed:", e)
      }
    }

    if (action === "connect") {
      // Connect Discord to existing account
      const session = await getSession()
      if (!session) {
        return NextResponse.redirect(`${baseUrl}/login?error=session_expired`)
      }

      // Check if this Discord account is already connected to another user
      const existingConnection = await pool.query(
        "SELECT user_id FROM discord_connections WHERE discord_id = $1",
        [discordUser.id]
      )
      if (existingConnection.rows.length > 0 && existingConnection.rows[0].user_id !== session.userId) {
        return NextResponse.redirect(`${baseUrl}/profile?tab=account&error=discord_already_linked`)
      }

      // Upsert discord connection
      await pool.query(
        `INSERT INTO discord_connections 
         (user_id, discord_id, discord_username, discord_discriminator, discord_avatar, discord_email, access_token, refresh_token, token_expires_at, guild_joined)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id) DO UPDATE SET
           discord_id = $2, discord_username = $3, discord_discriminator = $4, discord_avatar = $5,
           discord_email = $6, access_token = $7, refresh_token = $8, token_expires_at = $9,
           guild_joined = $10, updated_at = NOW()`,
        [
          session.userId,
          discordUser.id,
          discordUser.username,
          discordUser.discriminator,
          discordUser.avatar,
          discordUser.email || null,
          tokens.access_token,
          tokens.refresh_token,
          tokenExpiresAt,
          guildJoined,
        ]
      )

      // Update user's discord_id
      await pool.query("UPDATE users SET discord_id = $1 WHERE id = $2", [discordUser.id, session.userId])

      // Optionally update avatar if user doesn't have one
      if (discordUser.avatar) {
        await pool.query(
          "UPDATE users SET avatar_url = $1 WHERE id = $2 AND avatar_url IS NULL",
          [`https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`, session.userId]
        )
      }

      return NextResponse.redirect(`${baseUrl}/profile?tab=account&success=discord_connected`)
    } else {
      // Login with Discord
      // Check if Discord account is linked to a user
      const connectionResult = await pool.query(
        "SELECT user_id FROM discord_connections WHERE discord_id = $1",
        [discordUser.id]
      )

      let userId: number

      if (connectionResult.rows.length > 0) {
        // Existing user - log them in
        userId = connectionResult.rows[0].user_id

        // Update tokens
        await pool.query(
          `UPDATE discord_connections SET 
           discord_username = $1, discord_avatar = $2, discord_email = $3,
           access_token = $4, refresh_token = $5, token_expires_at = $6, 
           guild_joined = $7, updated_at = NOW()
           WHERE discord_id = $8`,
          [
            discordUser.username,
            discordUser.avatar,
            discordUser.email || null,
            tokens.access_token,
            tokens.refresh_token,
            tokenExpiresAt,
            guildJoined,
            discordUser.id,
          ]
        )
      } else {
        // New user - create account if we have email
        if (!discordUser.email) {
          return NextResponse.redirect(`${baseUrl}/login?error=discord_no_email`)
        }

        // Check if email already exists
        const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [discordUser.email])
        
        if (existingUser.rows.length > 0) {
          // Email exists but not linked to Discord - prompt to link
          return NextResponse.redirect(`${baseUrl}/login?error=discord_email_exists&email=${encodeURIComponent(discordUser.email)}`)
        }

        // Create new user (password is random since they'll use Discord to login)
        const randomPassword = crypto.randomBytes(32).toString("hex")
        const passwordHash = await import("bcrypt").then(bcrypt => bcrypt.hash(randomPassword, 12))
        
        const avatarUrl = discordUser.avatar 
          ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
          : null

        const userResult = await pool.query(
          `INSERT INTO users (email, password_hash, name, avatar_url, discord_id, email_verified_at, tos_accepted_at, onboarding_completed)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), true) RETURNING id`,
          [discordUser.email, passwordHash, discordUser.username, avatarUrl, discordUser.id]
        )
        userId = userResult.rows[0].id

        // Create discord connection
        await pool.query(
          `INSERT INTO discord_connections 
           (user_id, discord_id, discord_username, discord_discriminator, discord_avatar, discord_email, access_token, refresh_token, token_expires_at, guild_joined)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            userId,
            discordUser.id,
            discordUser.username,
            discordUser.discriminator,
            discordUser.avatar,
            discordUser.email,
            tokens.access_token,
            tokens.refresh_token,
            tokenExpiresAt,
            guildJoined,
          ]
        )
      }

      // Create session
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      const userAgent = request.headers.get("user-agent") || "unknown"
      await createSession(userId, ip, userAgent)

      return NextResponse.redirect(`${baseUrl}/dashboard`)
    }
  } catch (error) {
    console.error("[Discord] OAuth callback error:", error)
    return NextResponse.redirect(`${baseUrl}/login?error=discord_failed`)
  }
}
