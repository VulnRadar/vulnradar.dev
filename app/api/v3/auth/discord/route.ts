// Discord OAuth - Initiate OAuth flow

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import {
  signDiscordState,
  DISCORD_NONCE_COOKIE,
  DISCORD_STATE_TTL_MS,
} from "@/lib/auth/discord-state";

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// GET /api/v3/auth/discord - Start OAuth flow
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

  // Build redirect URI from the resolved app URL (DB admin override, then
  // NEXT_PUBLIC_APP_URL, then this request's own origin).
  const baseUrl = await resolveAppUrl(request);
  const redirectUri = `${baseUrl}/api/v3/auth/discord/callback`;

  // Build Discord OAuth URL
  const scopes = ["identify", "email", "guilds.join"];
  // auth: state is HMAC-signed (see lib/auth/discord-state.ts). Also
  // bind userId when available to prevent replay by another session.
  //
  // The userId binding is not enough on its own for sign-in: a logged-out
  // caller has no userId, JSON.stringify drops the key, and the callback's
  // binding check is skipped entirely. So a sign-in also gets a nonce cookie,
  // exactly like the sibling /api/v3/auth/oauth/[provider] flow, which the
  // callback requires to match before it will create a session. The connect
  // flow needs no cookie: it already has a real userId in the state.
  const loginNonce =
    action === "login" ? randomBytes(16).toString("base64url") : undefined;
  const state = signDiscordState({
    action,
    userId: session?.userId,
    nonce: loginNonce,
  });

  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", DISCORD_CLIENT_ID);
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("response_type", "code");
  discordAuthUrl.searchParams.set("scope", scopes.join(" "));
  discordAuthUrl.searchParams.set("state", state);
  discordAuthUrl.searchParams.set("prompt", "consent");

  const response = NextResponse.redirect(discordAuthUrl.toString());
  if (loginNonce) {
    response.cookies.set(DISCORD_NONCE_COOKIE, loginNonce, {
      httpOnly: true,
      secure: baseUrl.startsWith("https://"),
      sameSite: "lax", // must survive the top-level redirect back from Discord
      path: "/",
      maxAge: Math.ceil(DISCORD_STATE_TTL_MS / 1000),
    });
  }
  return response;
}
