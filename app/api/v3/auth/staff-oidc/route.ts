// Staff SSO -- start the OIDC flow. See app/api/v3/auth/staff-oidc/callback/
// for the other half, and lib/auth/staff-oidc.ts for the security posture
// (never creates or promotes an account; only signs into an existing
// staff-or-above account whose email matches the IdP's).
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import {
  getStaffOidcConfig,
  getDiscoveryDocument,
} from "@/lib/auth/staff-oidc";
import { signOAuthState } from "@/lib/auth/oauth-state";

export async function GET(request: Request) {
  const baseUrl = await resolveAppUrl(request);

  const config = await getStaffOidcConfig();
  if (!config) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  }

  let doc;
  try {
    doc = await getDiscoveryDocument(config.issuerUrl);
  } catch (err) {
    console.error("[staff-oidc] discovery failed:", err);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed`);
  }

  // The nonce embedded in the ID token has to match a value only this
  // request could have produced -- reuse the same signed-state nonce
  // lib/auth/oauth-state.ts already generates for the other OAuth flows,
  // sent to the IdP as the OIDC `nonce` param and checked back against the
  // verified ID token's own `nonce` claim in the callback
  // (verifyStaffOidcIdToken).
  const state = signOAuthState("staff-oidc");
  const nonce = randomBytes(16).toString("base64url");

  const redirectUri = `${baseUrl}/api/v3/auth/staff-oidc/callback`;
  const authUrl = new URL(doc.authorization_endpoint);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);

  const response = NextResponse.redirect(authUrl.toString());
  // The nonce itself doesn't need to survive a redirect to a third party
  // the way `state` does (state round-trips through the IdP and back;
  // the nonce is only ever read back out of the ID token itself, which
  // this browser never sees or could tamper with) -- but the callback
  // still needs to know what value to check the token's nonce claim
  // against, so it travels in a short-lived, httpOnly cookie instead of
  // being embedded in the state payload (state is provider-agnostic and
  // already at its intended shape).
  response.cookies.set("staff_oidc_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
  return response;
}
