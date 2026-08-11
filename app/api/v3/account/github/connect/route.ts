import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { signOAuthState } from "@/lib/auth/oauth-state";
import { buildGithubAuthorizeUrl } from "@/lib/github/github-oauth";
import { resolveAppUrl } from "@/lib/config/runtime-config";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;

// GitHub OAuth Apps only accept ONE registered "Authorization callback URL"
// (confirmed against https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
// -- there is no way to register a second URL for this repo-connect flow's
// own callback path alongside the identity sign-in flow's, since both share
// the same GITHUB_CLIENT_ID/SECRET. So this redirects through the SAME
// callback endpoint sign-in already uses (already registered on GitHub),
// disambiguated by the signed state's `purpose: "github-connect"` --
// see the dispatch in app/api/v3/auth/oauth/[provider]/callback/route.ts.
//
// Resolved via the same resolveAppUrl() every other OAuth-family route
// uses (DB admin override, then NEXT_PUBLIC_APP_URL, then this request's
// own origin) rather than a bespoke env-only check: that callback route
// resolves ITS OWN baseUrl the same way, and the two have to agree exactly
// or GitHub's token exchange rejects the redirect_uri mismatch.
async function sharedCallbackUrl(request: Request): Promise<string> {
  const base = await resolveAppUrl(request);
  return `${base}/api/v3/auth/oauth/github/callback`;
}

// GET /api/v3/account/github/connect — start the GitHub repo-connect OAuth flow.
// Separate from any identity-only "Sign in with GitHub" OAuth: this always
// requires an existing session (Part 1 of the feature — an already-logged-in
// user connects their account), there is no sign-up/sign-in variant here.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!GITHUB_CLIENT_ID) {
    return NextResponse.json(
      { error: "GitHub integration is not configured on this server." },
      { status: 500 },
    );
  }

  // No separate state cookie needed: the state is HMAC-signed and bound to
  // this session's userId (re-checked against the CURRENT session in the
  // callback, same pattern the "link" purpose already uses), which is
  // equivalent replay protection to the old cookie+signature double-check
  // without needing a cookie only this flow understood.
  const state = signOAuthState("github", {
    purpose: "github-connect",
    userId: session.userId,
  });
  const authorizeUrl = buildGithubAuthorizeUrl({
    clientId: GITHUB_CLIENT_ID,
    redirectUri: await sharedCallbackUrl(request),
    state,
  });

  return NextResponse.redirect(authorizeUrl);
}
