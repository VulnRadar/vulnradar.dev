// OAuth sign-up/sign-in callback (google | github | discord).
//
// Email-collision handling (the reason this exists as its own module
// rather than reusing app/api/v3/auth/discord/callback/route.ts):
//   - No account with this email: create one. password_hash is NULL,
//     email_verified_at is set immediately (the provider already verified
//     the address), auth_provider records which provider created it.
//   - An account already exists with this email, created by a DIFFERENT
//     provider (or by password signup): reject. Never auto-links, never
//     creates a second account for the same email.
//   - An account already exists, created by this SAME provider: log in
//     normally, honoring 2FA exactly like a password login would.

import { NextResponse } from "next/server";
import { randomInt, randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { createOAuthUser, createSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { loadConfig } from "@/lib/config/config";
import { getSetting } from "@/lib/config/runtime-config";
import {
  isOAuthProviderConfigured,
  isOAuthProviderId,
  oauthLabelForAuthProvider,
} from "@/lib/auth/oauth-providers";
import { verifyOAuthState } from "@/lib/auth/oauth-state";
import { exchangeOAuthCode, fetchOAuthUserInfo } from "@/lib/auth/oauth-userinfo";
import { findTrustedDevice } from "@/lib/auth/device-trust";
import { getClientIp } from "@/lib/api/request-utils";
import { sendEmail, email2FACodeEmail } from "@/lib/email/email";
import { DEVICE_TRUST_COOKIE_NAME } from "@/lib/config/constants";

// Separate cookie from the password-login AUTH_2FA_PENDING_COOKIE (see
// lib/config/constants.ts) and distinct from Discord's own
// "discord_pending_login" (app/api/v3/auth/discord/callback/route.ts).
// app/api/v3/auth/2fa/verify/route.ts checks for both this one and
// Discord's, and app/login/page.tsx reads the matching `oauth_2fa=pending`
// query param, so any provider handled here reuses the same 2FA
// verification UI/endpoint instead of a bespoke one per provider.
const OAUTH_PENDING_LOGIN_COOKIE = "oauth_pending_login";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const config = loadConfig();
  const baseUrl = config.app?.url || new URL(request.url).origin;

  if (!isOAuthProviderId(provider)) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_invalid`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_denied`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_invalid`);
  }
  if (!isOAuthProviderConfigured(provider)) {
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_not_configured`);
  }

  const verified = verifyOAuthState(state, provider);
  if (!verified.ok) {
    const reason =
      verified.reason === "expired" ? "oauth_expired" : "oauth_invalid_state";
    return NextResponse.redirect(`${baseUrl}/login?error=${reason}`);
  }

  const redirectUri = `${baseUrl}/api/v3/auth/oauth/${provider}/callback`;

  try {
    const tokens = await exchangeOAuthCode(provider, code, redirectUri);
    if (!tokens) {
      return NextResponse.redirect(`${baseUrl}/login?error=oauth_token_failed`);
    }

    const userInfo = await fetchOAuthUserInfo(provider, tokens.accessToken);
    if (!userInfo) {
      return NextResponse.redirect(`${baseUrl}/login?error=oauth_user_failed`);
    }
    if (!userInfo.email || !userInfo.emailVerified) {
      return NextResponse.redirect(
        `${baseUrl}/login?error=oauth_email_unverified`,
      );
    }

    const normalizedEmail = userInfo.email.toLowerCase().trim();

    const existing = await pool.query(
      "SELECT id, auth_provider, disabled_at FROM users WHERE email = $1",
      [normalizedEmail],
    );

    const ip = (await getClientIp()) ?? "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    // ── No account with this email: create one. ──────────────────────
    if (existing.rows.length === 0) {
      const created = await createOAuthUser(normalizedEmail, userInfo.name, provider);

      await pool.query(
        `INSERT INTO notification_preferences (
            user_id,
            email_security, email_new_login, email_password_change, email_2fa_change, email_session_revoked,
            email_scan_complete, email_critical_findings, email_regression_alert, email_schedules,
            email_api_keys, email_api_limit_warning, email_webhooks, email_webhook_failure,
            email_data_requests, email_account_deletion, email_team_invite, email_team_changes,
            email_product_updates, email_tips_guides
          ) VALUES ($1, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, false)
             ON CONFLICT (user_id) DO NOTHING`,
        [created.id],
      );

      if (userInfo.avatarUrl) {
        await pool.query(
          "UPDATE users SET avatar_url = $1 WHERE id = $2 AND avatar_url IS NULL",
          [userInfo.avatarUrl, created.id],
        );
      }

      await createSession(created.id, ip, userAgent);
      return NextResponse.redirect(`${baseUrl}/dashboard`);
    }

    // ── An account already exists with this email. ───────────────────
    const row = existing.rows[0];

    if (row.auth_provider !== provider) {
      const existingLabel = oauthLabelForAuthProvider(row.auth_provider);
      const message = existingLabel
        ? `An account with this email already exists. Sign in with ${existingLabel} instead.`
        : "An account with this email already exists. Sign in with your password instead.";
      return NextResponse.redirect(
        `${baseUrl}/login?error=oauth_email_in_use&message=${encodeURIComponent(message)}`,
      );
    }

    if (row.disabled_at) {
      return NextResponse.redirect(`${baseUrl}/login?error=oauth_account_disabled`);
    }

    const userId = row.id as number;

    // Same provider that created the account: log in, honoring 2FA the
    // same way a password login would (device-trust bypass, TOTP vs email
    // code, everything except the "enter your password" step itself,
    // which OAuth already stood in for).
    const twoFAResult = await pool.query(
      "SELECT totp_enabled, two_factor_method, email FROM users WHERE id = $1",
      [userId],
    );
    const twoFA = twoFAResult.rows[0];

    if (twoFA?.totp_enabled) {
      const cookieStore = await cookies();
      const deviceCookie = cookieStore.get(DEVICE_TRUST_COOKIE_NAME)?.value;

      if (deviceCookie && (await findTrustedDevice(userId, deviceCookie))) {
        await createSession(userId, ip, userAgent);
        return NextResponse.redirect(`${baseUrl}/dashboard`);
      }

      const method = twoFA.two_factor_method || "app";
      cookieStore.set(
        OAUTH_PENDING_LOGIN_COOKIE,
        JSON.stringify({ userId, method, email: twoFA.email, ts: Date.now() }),
        {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 300, // 5 minutes
          path: "/",
        },
      );

      if (method === "email") {
        setImmediate(() => {
          sendOAuthEmail2FACode(userId, twoFA.email).catch((err) => {
            console.error("[OAuth] Background email 2FA send failed:", err);
          });
        });
      }

      return NextResponse.redirect(
        `${baseUrl}/login?oauth_2fa=pending&method=${method}`,
      );
    }

    await createSession(userId, ip, userAgent);
    return NextResponse.redirect(`${baseUrl}/dashboard`);
  } catch (err) {
    console.error(`[OAuth:${provider}] callback error:`, err);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed`);
  }
}

async function sendOAuthEmail2FACode(
  userId: number,
  userEmail: string,
): Promise<void> {
  await pool.query("DELETE FROM email_2fa_codes WHERE user_id = $1", [userId]);
  const code = randomInt(100000, 999999).toString();
  const codeSalt = randomBytes(32).toString("hex");
  const codeHash = createHash("sha256")
    .update(`${codeSalt}:${code}`)
    .digest("hex");
  const codeExpiryMinutes = await getSetting("EMAIL_2FA_CODE_EXPIRY_MINUTES");
  await pool.query(
    "INSERT INTO email_2fa_codes (user_id, code_hash, code_salt, expires_at) VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 minute'))",
    [userId, codeHash, codeSalt, codeExpiryMinutes],
  );
  const emailContent = email2FACodeEmail(code);
  await sendEmail({
    to: userEmail,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
}
