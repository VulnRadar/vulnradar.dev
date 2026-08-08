import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import {
  verifyGithubState,
  GITHUB_CONNECT_STATE_COOKIE,
} from "@/lib/github/github-state";
import { exchangeGithubCode, fetchGithubUser } from "@/lib/github/github-oauth";
import { saveGithubConnection } from "@/lib/github/github-connections";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

function baseUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

function callbackUrl(request: Request): string {
  return `${baseUrl(request)}/api/v3/account/github/connect/callback`;
}

// GET /api/v3/account/github/connect/callback — GitHub OAuth callback for
// the account-linking flow. Always redirects the browser back to the
// Developer tab in Profile (success or failure) rather than returning
// JSON, since this endpoint is only ever hit via a top-level browser
// navigation from github.com.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const base = baseUrl(request);
  const profileUrl = new URL(`${base}/profile`);
  profileUrl.searchParams.set("tab", "developer");
  profileUrl.searchParams.set("dtab", "github");

  const fail = (reason: string) => {
    const url = new URL(profileUrl.toString());
    url.searchParams.set("github_error", reason);
    const res = NextResponse.redirect(url.toString());
    res.cookies.delete(GITHUB_CONNECT_STATE_COOKIE);
    return res;
  };

  if (oauthError) return fail("denied");
  if (!code || !state) return fail("invalid");
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) return fail("not_configured");

  const session = await getSession();
  if (!session) return fail("session_expired");

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(GITHUB_CONNECT_STATE_COOKIE)?.value;

  // The state must match both the signed value AND the cookie set when the
  // flow started — the cookie check stops an attacker who intercepts (or
  // is handed) just the redirect URL from replaying it in a different
  // browser session, since they would not also have the httpOnly cookie.
  if (!cookieState || cookieState !== state) return fail("invalid_state");

  const verified = verifyGithubState(state, session.userId);
  if (!verified.ok) {
    const reason =
      verified.reason === "expired" ? "expired" : "invalid_state";
    return fail(reason);
  }

  try {
    const token = await exchangeGithubCode({
      clientId: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET,
      code,
      redirectUri: callbackUrl(request),
    });
    const githubUser = await fetchGithubUser(token.accessToken);

    await saveGithubConnection({
      userId: session.userId,
      githubUserId: githubUser.id,
      githubUsername: githubUser.login,
      accessToken: token.accessToken,
      scopes: token.scopes,
    });

    const url = new URL(profileUrl.toString());
    url.searchParams.set("github_connected", "true");
    const res = NextResponse.redirect(url.toString());
    res.cookies.delete(GITHUB_CONNECT_STATE_COOKIE);
    return res;
  } catch (err) {
    console.error(
      "[GitHub Connect] OAuth callback error:",
      err instanceof Error ? err.message : err,
    );
    return fail("failed");
  }
}
