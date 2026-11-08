// OAuth sign-up/sign-in -- start the flow for a given provider
// (google | github | discord). See app/api/v3/auth/oauth/[provider]/callback/
// for the other half. This is intentionally separate from
// app/api/v3/auth/discord/ (the existing account-linking flow): there is no
// "connect to an existing account" mode here, only "sign in, creating an
// account on first use" -- EXCEPT for `?action=link` (Google/GitHub only,
// see below), which is the one deliberate exception. GET starts a sign-in;
// a link starts from POST, because it has to carry the account password.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import {
  OAUTH_PROVIDERS,
  getOAuthClientId,
  isOAuthProviderConfigured,
  isOAuthProviderId,
  type OAuthProviderId,
} from "@/lib/auth/oauth-providers";
import { randomBytes } from "node:crypto";
import {
  signOAuthState,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from "@/lib/auth/oauth-state";
import { cookiesRequireHttps } from "@/lib/auth/cookie-secure";
import { refuseWhileImpersonating } from "@/lib/auth/impersonation-guard";
import { verifyReauthPassword } from "@/lib/auth/reauth";
import { safeRedirect } from "@/lib/auth/safe-redirect";
import { getClientIp } from "@/lib/api/request-utils";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

const CONFIRM_PASSWORD_FIRST = "Confirm your password first";

function startableProvider(
  provider: string,
): { provider: OAuthProviderId } | { refused: NextResponse } {
  if (!isOAuthProviderId(provider)) {
    return {
      refused: NextResponse.json(
        { error: "Unknown sign-in provider." },
        { status: 404 },
      ),
    };
  }
  if (!isOAuthProviderConfigured(provider)) {
    return {
      refused: NextResponse.json(
        {
          error: `${OAUTH_PROVIDERS[provider].label} sign-in is not configured.`,
        },
        { status: 500 },
      ),
    };
  }
  return { provider };
}

// Who may link at all, before anyone is asked for a password. Shared by the
// GET, which goes no further than this, and the POST.
async function linkingSession(
  provider: OAuthProviderId,
): Promise<{ userId: number } | { refused: NextResponse }> {
  if (provider === "discord") {
    return {
      refused: NextResponse.json(
        {
          error:
            "Use /api/v3/auth/discord?action=connect to link a Discord account.",
        },
        { status: 400 },
      ),
    };
  }
  const session = await getSession();
  if (!session) {
    return {
      refused: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const refused = refuseWhileImpersonating(
    session,
    "Linking a sign-in provider",
  );
  if (refused) return { refused };
  return { userId: session.userId };
}

async function authorizeUrl(
  request: Request,
  provider: OAuthProviderId,
  state: string,
): Promise<URL> {
  const baseUrl = await resolveAppUrl(request);
  const redirectUri = `${baseUrl}/api/v3/auth/oauth/${provider}/callback`;
  const providerConfig = OAUTH_PROVIDERS[provider];

  const authUrl = new URL(providerConfig.authorizeUrl);
  authUrl.searchParams.set("client_id", getOAuthClientId(provider)!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", providerConfig.scope);
  authUrl.searchParams.set("state", state);
  if (provider === "google") {
    // Always show the account chooser -- without this, a browser already
    // signed into exactly one Google account skips straight past it, which
    // is surprising the first time someone means to switch accounts.
    authUrl.searchParams.set("prompt", "select_account");
  }
  return authUrl;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const startable = startableProvider((await params).provider);
  if ("refused" in startable) return startable.refused;
  const { provider } = startable;

  // `?action=link` attaches this provider's identity to the CURRENT
  // session's account instead of signing in/up (components/profile/tabs/
  // profile-social-tab.tsx's Connections cards use this). Discord already
  // has its own dedicated linking flow (app/api/v3/auth/discord/), with
  // its own state format and its own bot-invite/guild-join handling that
  // this route never touches -- so linking Discord through here would
  // just be a second, divergent implementation of the same feature.
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") === "link" ? "link" : "login";

  // Which button was actually clicked -- login-form.tsx vs signup-form.tsx
  // (components/auth/oauth-buttons.tsx passes this through). Defaults to
  // "signup" so an old bookmarked/cached start URL with no intent param
  // keeps today's create-on-first-use behavior instead of silently
  // refusing to ever create an account.
  const intent = searchParams.get("intent") === "login" ? "login" : "signup";

  // A navigation cannot carry a password, and adding a passwordless way into
  // the account is exactly what a stolen session would want to do with one
  // visit, so a link only starts from the POST below.
  if (action === "link") {
    const linking = await linkingSession(provider);
    if ("refused" in linking) return linking.refused;
    return NextResponse.json(
      { error: CONFIRM_PASSWORD_FIRST },
      { status: 400 },
    );
  }

  // Sign-in/sign-up only: bind the flow to THIS browser. Generate a nonce,
  // sign it into the state, and drop it in a short-lived httpOnly cookie the
  // callback will require to match -- so a state an attacker minted for their
  // own identity can't be replayed into a victim's browser to silently log the
  // victim into the attacker's account (login CSRF / session fixation).
  const loginNonce = randomBytes(16).toString("base64url");
  const redirect = safeRedirect(searchParams.get("redirect"), "") || undefined;
  const authUrl = await authorizeUrl(
    request,
    provider,
    signOAuthState(provider, { intent, nonce: loginNonce, redirect }),
  );

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set(OAUTH_NONCE_COOKIE, loginNonce, {
    httpOnly: true,
    secure: cookiesRequireHttps(),
    sameSite: "lax", // must survive the top-level redirect back from the IdP
    path: "/",
    maxAge: Math.ceil(OAUTH_STATE_TTL_MS / 1000),
  });
  return response;
}

// POST ?action=link: re-authenticate, then answer the provider URL for the
// client to navigate to. The state is bound to the session's userId, which is
// why this flow needs no nonce cookie.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const startable = startableProvider((await params).provider);
  if ("refused" in startable) return startable.refused;
  const { provider } = startable;

  if (new URL(request.url).searchParams.get("action") !== "link") {
    return NextResponse.json(
      { error: "Only ?action=link starts from a POST." },
      { status: 400 },
    );
  }

  const linking = await linkingSession(provider);
  if ("refused" in linking) return linking.refused;
  const { userId } = linking;

  // auth: same budget as every other password re-prompt, so a stolen session
  // cannot use this to guess the account password.
  const ip = await getClientIp();
  const rl = await checkRateLimit({
    key: `oauth-link:${userId}:${ip}`,
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
  const reauth = await verifyReauthPassword(userId, body?.password, {
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
    provider,
    signOAuthState(provider, { purpose: "link", userId }),
  );
  return NextResponse.json({ url: authUrl.toString() });
}
