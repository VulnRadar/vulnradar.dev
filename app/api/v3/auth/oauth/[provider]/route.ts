// OAuth sign-up/sign-in -- start the flow for a given provider
// (google | github | discord). See app/api/v3/auth/oauth/[provider]/callback/
// for the other half. This is intentionally separate from
// app/api/v3/auth/discord/ (the existing account-linking flow): there is no
// "connect to an existing account" mode here, only "sign in, creating an
// account on first use."

import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config/config";
import {
  OAUTH_PROVIDERS,
  getOAuthClientId,
  isOAuthProviderConfigured,
  isOAuthProviderId,
} from "@/lib/auth/oauth-providers";
import { signOAuthState } from "@/lib/auth/oauth-state";

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

  const config = loadConfig();
  const baseUrl = config.app?.url || new URL(request.url).origin;
  const redirectUri = `${baseUrl}/api/v3/auth/oauth/${provider}/callback`;
  const providerConfig = OAUTH_PROVIDERS[provider];

  const authUrl = new URL(providerConfig.authorizeUrl);
  authUrl.searchParams.set("client_id", getOAuthClientId(provider)!);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", providerConfig.scope);
  authUrl.searchParams.set("state", signOAuthState(provider));
  if (provider === "google") {
    // Always show the account chooser -- without this, a browser already
    // signed into exactly one Google account skips straight past it, which
    // is surprising the first time someone means to switch accounts.
    authUrl.searchParams.set("prompt", "select_account");
  }

  return NextResponse.redirect(authUrl.toString());
}
