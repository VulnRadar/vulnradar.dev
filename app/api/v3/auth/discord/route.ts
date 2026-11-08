// Discord OAuth - Initiate OAuth flow

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/auth";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import {
  signDiscordState,
  parseDiscordAction,
  DISCORD_NONCE_COOKIE,
  DISCORD_STATE_TTL_MS,
} from "@/lib/auth/discord-state";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CONFIRM_PASSWORD_FIRST = "Confirm your password first";

async function authorizeUrl(
  request: Request,
  clientId: string,
  state: string,
): Promise<URL> {
  // Build redirect URI from the resolved app URL (DB admin override, then
  // APP_URL, then NEXT_PUBLIC_APP_URL as read at runtime, then this
  // request's own origin).
  const baseUrl = await resolveAppUrl(request);
  const redirectUri = `${baseUrl}/api/v3/auth/discord/callback`;

  const scopes = ["identify", "email", "guilds.join"];
  const discordAuthUrl = new URL("https://discord.com/api/oauth2/authorize");
  discordAuthUrl.searchParams.set("client_id", clientId);
  discordAuthUrl.searchParams.set("redirect_uri", redirectUri);
  discordAuthUrl.searchParams.set("response_type", "code");
  discordAuthUrl.searchParams.set("scope", scopes.join(" "));
  discordAuthUrl.searchParams.set("state", state);
  discordAuthUrl.searchParams.set("prompt", "consent");
  return discordAuthUrl;
}

// GET /api/v3/auth/discord - Start a Discord sign-in. A connect starts from
// the POST below, because it has to carry the account password.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  // "connect" (link to existing) or "login" (sign in with Discord). The
  // callback refuses any other action, so a state signed for one could never
  // complete; refusing here saves the visitor a trip through Discord's
  // consent screen that ends in an error.
  const action = parseDiscordAction(searchParams.get("action") || "connect");
  if (action === null) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (!DISCORD_CLIENT_ID) {
    return NextResponse.json(
      { error: "Discord integration not configured" },
      { status: 500 },
    );
  }

  // A sign-in can start with a session already open: bind it into the state so
  // a leaked/forwarded state URL can't be replayed by another signed-in
  // user.
  const session = await getSession();

  // A connect gives the account a way in that needs no password, so it never
  // starts from a navigation, which has no way to carry one.
  if (action === "connect") {
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const refused = refuseWhileImpersonating(
      session,
      "Linking a sign-in provider",
    );
    if (refused) return refused;
    return NextResponse.json(
      { error: CONFIRM_PASSWORD_FIRST },
      { status: 400 },
    );
  }

  // auth: state is HMAC-signed (see lib/auth/discord-state.ts). The userId
  // binding is not enough on its own for sign-in: a logged-out caller has no
  // userId, JSON.stringify drops the key, and the callback's binding check is
  // skipped entirely. So a sign-in also gets a nonce cookie, exactly like the
  // sibling /api/v3/auth/oauth/[provider] flow, which the callback requires
  // to match before it will create a session.
  const loginNonce = randomBytes(16).toString("base64url");
  const discordAuthUrl = await authorizeUrl(
    request,
    DISCORD_CLIENT_ID,
    signDiscordState({
      action,
      userId: session?.userId,
      nonce: loginNonce,
    }),
  );

  const response = NextResponse.redirect(discordAuthUrl.toString());
  response.cookies.set(DISCORD_NONCE_COOKIE, loginNonce, {
    httpOnly: true,
    secure: cookiesRequireHttps(),
    sameSite: "lax", // must survive the top-level redirect back from Discord
    path: "/",
    maxAge: Math.ceil(DISCORD_STATE_TTL_MS / 1000),
  });
  return response;
}

// POST /api/v3/auth/discord?action=connect - Re-authenticate, then answer the
// Discord URL for the client to navigate to. The state names the session's
// user, which is why this flow needs no nonce cookie.
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  if (
    parseDiscordAction(searchParams.get("action") || "connect") !== "connect"
  ) {
    return NextResponse.json(
      { error: "Only action=connect starts from a POST." },
      { status: 400 },
    );
  }

  if (!DISCORD_CLIENT_ID) {
    return NextResponse.json(
      { error: "Discord integration not configured" },
      { status: 500 },
    );
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const refused = refuseWhileImpersonating(
    session,
    "Linking a sign-in provider",
  );
  if (refused) return refused;

  // auth: same budget as every other password re-prompt, so a stolen session
  // cannot use this to guess the account password.
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `discord-connect:${session.userId}:${ip}`,
    ...RATE_LIMITS.login,
  });
  if (!rl.allowed) {
    const minutes = Math.ceil(rl.retryAfterSeconds / 60);
    return NextResponse.json(
      { error: `Too many attempts. Please try again in ${minutes} minute(s).` },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
  } | null;
  const reauth = await verifyReauthPassword(session.userId, body?.password, {
    missing: CONFIRM_PASSWORD_FIRST,
    wrong: "That password is not correct.",
  });
  if (!reauth.ok) {
    return NextResponse.json(
      { error: reauth.error },
      { status: reauth.status },
    );
  }

  const authUrl = await authorizeUrl(
    request,
    DISCORD_CLIENT_ID,
    signDiscordState({ action: "connect", userId: session.userId }),
  );
  return NextResponse.json({ url: authUrl.toString() });
}
