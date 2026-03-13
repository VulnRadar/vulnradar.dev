// ============================================================================
// Discord OAuth - Initiate OAuth flow
// ============================================================================

import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { loadConfig } from "@/lib/config"

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID

// GET /api/v2/auth/discord - Start OAuth flow
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get("action") || "connect" // "connect" (link to existing) or "login" (sign in with Discord)
  
  if (!DISCORD_CLIENT_ID) {
    return NextResponse.json({ error: "Discord integration not configured" }, { status: 500 })
  }

  // For "connect" action, require existing session
  if (action === "connect") {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // Build redirect URI from config or request URL
  const config = loadConfig()
  const baseUrl = config.app?.url || new URL(request.url).origin
  const redirectUri = `${baseUrl}/api/v2/auth/discord/callback`

  // Build Discord OAuth URL
  const scopes = ["identify", "email", "guilds.join"]
  const state = Buffer.from(JSON.stringify({ action, ts: Date.now() })).toString("base64url")
  
  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize")
  discordAuthUrl.searchParams.set("client_id", DISCORD_CLIENT_ID)
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri)
  discordAuthUrl.searchParams.set("response_type", "code")
  discordAuthUrl.searchParams.set("scope", scopes.join(" "))
  discordAuthUrl.searchParams.set("state", state)
  discordAuthUrl.searchParams.set("prompt", "consent")

  return NextResponse.redirect(discordAuthUrl.toString())
}
