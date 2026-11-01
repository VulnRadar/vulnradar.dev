// Staff SSO callback. See app/api/v3/auth/staff-oidc/route.ts for the
// start half and lib/auth/staff-oidc.ts for the full security posture.
//
// Deliberately narrow: this NEVER creates an account and NEVER changes a
// role. A successful callback only creates a session for an account that
// (a) already exists with the IdP's returned email, verified on this side
// too, and (b) is already staff-tier or above. Anything else is rejected with a generic error --
// specifically not "no account with that email" vs "account exists but
// isn't staff", since leaking that distinction would let anyone with IdP
// access enumerate which emails happen to be staff on this instance.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import pool from "@/lib/database/db";
import { createSession } from "@/lib/auth";
import { resolveAppUrl } from "@/lib/config/runtime-config";
import { STAFF_ROLE_HIERARCHY } from "@/lib/config/constants";
import { logAuditAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import {
  getStaffOidcConfig,
  getDiscoveryDocument,
  exchangeStaffOidcCode,
  verifyStaffOidcIdToken,
} from "@/lib/auth/staff-oidc";
import { verifyOAuthState } from "@/lib/auth/oauth-state";

export async function GET(request: Request) {
  const baseUrl = await resolveAppUrl(request);
  const fail = (reason: string) =>
    NextResponse.redirect(`${baseUrl}/login?error=${reason}`);

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");

  if (providerError) return fail("oauth_denied");
  if (!code || !state) return fail("oauth_invalid");

  const verified = verifyOAuthState(state, "staff-oidc");
  if (!verified.ok) {
    return fail(
      verified.reason === "expired" ? "oauth_expired" : "oauth_invalid_state",
    );
  }

  const config = await getStaffOidcConfig();
  if (!config) return fail("oauth_not_configured");

  const cookieStore = await cookies();
  const nonce = cookieStore.get("staff_oidc_nonce")?.value;
  cookieStore.delete("staff_oidc_nonce");
  if (!nonce) return fail("oauth_expired");

  try {
    const doc = await getDiscoveryDocument(config.issuerUrl);
    const redirectUri = `${baseUrl}/api/v3/auth/staff-oidc/callback`;
    const { idToken } = await exchangeStaffOidcCode(
      doc,
      config,
      code,
      redirectUri,
    );
    const claims = await verifyStaffOidcIdToken(idToken, config, doc, nonce);

    if (!claims.emailVerified) return fail("oauth_email_unverified");

    const result = await pool.query<{
      id: number;
      role: string | null;
      disabled_at: string | null;
      email_verified_at: string | null;
    }>(
      `SELECT id, role, disabled_at, email_verified_at FROM users WHERE email = $1`,
      [claims.email],
    );
    const user = result.rows[0];

    const role = user?.role || "user";
    const isStaff =
      (STAFF_ROLE_HIERARCHY[role] ?? 0) >= STAFF_ROLE_HIERARCHY.support;

    // Same generic rejection for "no account", "account isn't staff", and
    // "account disabled" -- see this file's header comment for why the
    // first two are deliberately not distinguished. A disabled account IS
    // told apart from the others below purely because that's already
    // public information surfaced elsewhere (a disabled account can't sign
    // in with a password either, so this reveals nothing new).
    if (!user || !isStaff) {
      return fail("oauth_no_account");
    }
    // An email match only says the row CLAIMS this address. PATCH
    // /api/v3/auth/update lets an account move to any address no other
    // account holds and only clears email_verified_at, so an unverified staff
    // row may belong to someone other than the IdP user who just proved the
    // address, and signing that user in would hand them that person's staff
    // access. The answer is the generic one, so it does not confirm that the
    // address belongs to staff, and it comes before the disabled check so an
    // unproven claim learns nothing else about the row.
    if (!user.email_verified_at) {
      await recordUnverifiedStaffSsoRefusal(
        user.id,
        new URL(config.issuerUrl).hostname,
      );
      return fail("oauth_no_account");
    }
    if (user.disabled_at) {
      return fail("oauth_account_disabled");
    }

    const ip = (await getClientIp()) ?? "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";
    await createSession(user.id, ip, userAgent);

    await logAuditAction(
      user.id,
      user.id,
      "staff_oidc_login",
      `Signed in via staff SSO (${new URL(config.issuerUrl).hostname}).`,
      ip,
    );

    return NextResponse.redirect(`${baseUrl}/admin`);
  } catch (err) {
    console.error("[staff-oidc] callback error:", err);
    return fail("oauth_failed");
  }
}

/**
 * Record that staff SSO refused an account because it never verified the
 * address the IdP matched it on. Either someone pointed that staff account at
 * an address they do not own, or its owner never verified it. An admin needs
 * to know about both, and the refusal alone tells nobody anything.
 *
 * A security alert rather than an admin_audit_log row because no admin acted.
 * No IP address or user agent: the request is the IdP user's, not the
 * account's, and the data export hands an account its own alerts, so they
 * would reach whoever set the address. One open alert per account, since the
 * same person will retry.
 *
 * Never throws. The refusal is the control; this only reports it.
 */
async function recordUnverifiedStaffSsoRefusal(
  userId: number,
  issuerHost: string,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO security_alerts
         (user_id, alert_type, severity, description, details)
       SELECT $1::int, $2::text, 'high', $3::text, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM security_alerts
          WHERE user_id = $1::int
            AND alert_type = $2::text
            AND resolved_at IS NULL
       )`,
      [
        userId,
        "staff_sso_unverified_email",
        "A staff SSO sign-in to this account was refused because the account has not verified its email address. Either the address was set on this account by someone who does not own it, or the account's owner never verified it.",
        JSON.stringify({ issuer: issuerHost }),
      ],
    )
    .catch((err) => {
      console.error("[staff-oidc] Failed to record refused sign-in:", err);
    });
}
