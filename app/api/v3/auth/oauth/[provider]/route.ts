// OAuth sign-up/sign-in -- start the flow for a given provider
// (google | github | discord). See app/api/v3/auth/oauth/[provider]/callback/
// for the other half. This is intentionally separate from
// app/api/v3/auth/discord/ (the existing account-linking flow): there is no
// "connect to an existing account" mode here, only "sign in, creating an
// account on first use" -- EXCEPT for `?action=link` (Google/GitHub only,
// see below), which is the one deliberate exception.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import {
  OAUTH_PROVIDERS,
  getOAuthClientId,
  isOAuthProviderConfigured,
  isOAuthProviderId,
} from "@/lib/auth/oauth-providers";
import { randomBytes } from "node:crypto";
import {
  signOAuthState,
  OAUTH_NONCE_COOKIE,
  OAUTH_STATE_TTL_MS,
} from "@/lib/auth/oauth-state";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (!isOAuthProviderId(provider)) {
    return NextResponse.json(
      { error: "Unknown sign-in provider." },
      { status: 404 },
    );
  }

  if (!isOAuthProviderConfigured(provider)) {
    return NextResponse.json(
      {
        error: `${OAUTH_PROVIDERS[provider].label} sign-in is not configured.`,
      },
      { status: 500 },
    );
  }

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

  let linkUserId: number | undefined;
  if (action === "link") {
    if (provider === "discord") {
      return NextResponse.json(
        {
          error:
            "Use /api/v3/auth/discord?action=connect to link a Discord account.",
        },
        { status: 400 },
      );
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    linkUserId = session.userId;
  }

  const baseUrl = await resolveAppUrl(request);
  const redirectUri = `${baseUrl}/api/v3/auth/oauth/${provider}/callback`;
  const providerConfig = OAUTH_PROVIDERS[provider];

  const authUrl = new URL(providerConfig.authorizeUrl);
  authUrl.searchParams.set("client_id", getOAuthClientId(provider)!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", providerConfig.scope);
  // Plain sign-in/sign-up: bind the flow to THIS browser. Generate a nonce,
  // sign it into the state, and drop it in a short-lived httpOnly cookie the
  // callback will require to match -- so a state an attacker minted for their
  // own identity can't be replayed into a victim's browser to silently log the
  // victim into the attacker's account (login CSRF / session fixation). The
  // link flow is already bound to the session via userId, so it needs no cookie.
  const loginNonce =
    action === "link" ? undefined : randomBytes(16).toString("base64url");

  authUrl.searchParams.set(
    "state",
    action === "link"
      ? signOAuthState(provider, { purpose: "link", userId: linkUserId })
      : signOAuthState(provider, { intent, nonce: loginNonce }),
  );
  if (provider === "google") {
    // Always show the account chooser -- without this, a browser already
    // signed into exactly one Google account skips straight past it, which
    // is surprising the first time someone means to switch accounts.
    authUrl.searchParams.set("prompt", "select_account");
  }

  const response = NextResponse.redirect(authUrl.toString());
  if (loginNonce) {
    response.cookies.set(OAUTH_NONCE_COOKIE, loginNonce, {
      httpOnly: true,
      secure: baseUrl.startsWith("https://"),
      sameSite: "lax", // must survive the top-level redirect back from the IdP
      path: "/",
      maxAge: Math.ceil(OAUTH_STATE_TTL_MS / 1000),
    });
  }
  return response;
}
