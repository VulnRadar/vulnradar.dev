// Discord OAuth - Initiate OAuth flow

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadConfig } from "@/lib/config/config";
import { signDiscordState } from "@/lib/auth/discord-state";

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// GET /api/v2/auth/discord - Start OAuth flow
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "connect"; // "connect" (link to existing) or "login" (sign in with Discord)

  if (!DISCORD_CLIENT_ID) {
    return NextResponse.json(
      { error: "Discord integration not configured" },
      { status: 500 },
    );
  }

  // For "connect" action, require existing session.
  // Even for "login", we may have a session — bind it into the state so
  // a leaked/forwarded state URL can't be replayed by another signed-in
  // user.
  const session = await getSession();

  if (action === "connect" && !session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Build redirect URI from config or request URL
  const config = loadConfig();
  const baseUrl = config.app?.url || new URL(request.url).origin;
  const redirectUri = `${baseUrl}/api/v2/auth/discord/callback`;

  // Build Discord OAuth URL
  const scopes = ["identify", "email", "guilds.join"];
  // H-5: state is HMAC-signed (see lib/auth/discord-state.ts).
  // Also bind userId when available to prevent replay by another session.
  const state = signDiscordState({
    action,
    userId: session?.userId,
  });

  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("response_type", "code");
  discordAuthUrl.searchParams.set("scope", scopes.join(" "));
  discordAuthUrl.searchParams.set("state", state);
  discordAuthUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(discordAuthUrl.toString());
}
