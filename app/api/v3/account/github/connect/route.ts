import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { signGithubState, GITHUB_CONNECT_STATE_COOKIE } from "@/lib/github/github-state";
import { buildGithubAuthorizeUrl } from "@/lib/github/github-oauth";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;

function callbackUrl(request: Request): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  return `${base}/api/v3/account/github/connect/callback`;
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

  const state = signGithubState(session.userId);
  const authorizeUrl = buildGithubAuthorizeUrl({
    clientId: GITHUB_CLIENT_ID,
    redirectUri: callbackUrl(request),
    state,
  });

  const res = NextResponse.redirect(authorizeUrl);
  // httpOnly + short TTL: only the callback route ever reads this, never
  // client JS. sameSite=lax (not strict) because the browser navigates
  // back here from github.com — a strict cookie would not be sent on
  // that top-level cross-site redirect.
  res.cookies.set(GITHUB_CONNECT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
  return res;
}
