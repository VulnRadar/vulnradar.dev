// OAuth sign-up/sign-in callback (google | github | discord). Also handles
// the account-linking completion for Google/GitHub (state `purpose ===
// "link"`, signed by this same provider's route.ts's `?action=link`) --
// see handleOAuthLink() below.
//
// Email-collision handling for the sign-up/sign-in path (the reason this
// exists as its own module rather than reusing
// app/api/v3/auth/discord/callback/route.ts):
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
import {
  createOAuthUser,
  createSession,
  getSession,
  OAUTH_IDENTITY_COLUMNS,
} from "@/lib/auth";
import pool from "@/lib/database/db";
import { loadConfig } from "@/lib/config/config";
import { getSetting } from "@/lib/config/runtime-config";
import {
  OAUTH_PROVIDERS,
  isOAuthProviderConfigured,
  isOAuthProviderId,
  oauthLabelForAuthProvider,
  type OAuthProviderId,
} from "@/lib/auth/oauth-providers";
import {
  verifyOAuthState,
  type OAuthStatePayload,
} from "@/lib/auth/oauth-state";
import {
  exchangeOAuthCode,
  fetchOAuthUserInfo,
} from "@/lib/auth/oauth-userinfo";
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

  // Account-linking (Connections tab "Connect" button) branches off into
  // its own handler entirely: different success/failure destination
  // (/profile, not /login or /dashboard), different DB write (attach an
  // identity to the CURRENT session's user, never create or log into a
  // different account), different collision rule (reject if this identity
  // already belongs to someone else, rather than the sign-up flow's
  // email-collision handling above). Keeping it a separate function means
  // every test below this line -- all of which sign a state with no
  // `purpose` -- exercises the exact same code path as before.
  if (verified.payload.purpose === "link") {
    return handleOAuthLink(provider, verified.payload, code, baseUrl);
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
    // Absent only for a state signed before this field existed (the 5-minute
    // TTL makes that all but impossible in practice) -- default to "signup"
    // so an in-flight old link keeps today's create-on-first-use behavior
    // rather than suddenly refusing to sign anyone in.
    const intent = verified.payload.intent === "login" ? "login" : "signup";
    const ip = (await getClientIp()) ?? "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";

    // ── Provider-id-first match. ──────────────────────────────────────
    // If this exact Discord/Google/GitHub identity is already linked to an
    // account -- via profile-social-tab.tsx's Connect button, or a
    // previous sign-up through this same flow -- that's authoritative:
    // sign into THAT account regardless of what email this OAuth response
    // returned. Without this, an account whose linked identity uses a
    // different email than the one on file got a second, disconnected
    // account created on every subsequent "sign in with X" instead of
    // landing back on the same one.
    const idColumn = OAUTH_IDENTITY_COLUMNS[provider]?.id;
    if (idColumn && userInfo.id) {
      const byProviderId = await pool.query(
        `SELECT id, disabled_at FROM users WHERE ${idColumn} = $1`,
        [userInfo.id],
      );
      if (byProviderId.rows.length > 0) {
        const linked = byProviderId.rows[0];
        if (linked.disabled_at) {
          return NextResponse.redirect(
            `${baseUrl}/login?error=oauth_account_disabled`,
          );
        }
        return signInOAuthUser(linked.id, ip, userAgent, baseUrl);
      }
    }

    const existing = await pool.query(
      "SELECT id, auth_provider, disabled_at FROM users WHERE email = $1",
      [normalizedEmail],
    );

    // ── Neither this identity nor this email matches an account. ─────
    if (existing.rows.length === 0) {
      // The login page's OAuth buttons must only ever sign in to an
      // account that already exists -- never silently create one just
      // because someone clicked the wrong button.
      if (intent === "login") {
        const label = OAUTH_PROVIDERS[provider].label;
        const message = `No VulnRadar account uses this ${label} account yet. Sign up with ${label} first.`;
        return NextResponse.redirect(
          `${baseUrl}/login?error=oauth_no_account&message=${encodeURIComponent(message)}`,
        );
      }

      const created = await createOAuthUser(
        normalizedEmail,
        userInfo.name,
        provider,
        userInfo.id
          ? { id: userInfo.id, avatarUrl: userInfo.avatarUrl }
          : undefined,
      );

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

    // ── An account exists with this email (but not this identity). ───
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
      return NextResponse.redirect(
        `${baseUrl}/login?error=oauth_account_disabled`,
      );
    }

    // Same provider that created the account, but the provider-id lookup
    // above found nothing -- a legacy account from before this column was
    // populated at sign-up. Backfill it now so the NEXT sign-in matches on
    // identity directly instead of relying on email again.
    if (idColumn && userInfo.id) {
      await pool
        .query(`UPDATE users SET ${idColumn} = $1 WHERE id = $2`, [
          userInfo.id,
          row.id,
        ])
        .catch((err) => {
          // Non-fatal: a UNIQUE violation here would mean this identity is
          // already claimed by a different account, which the provider-id
          // lookup above should already have caught -- backfilling is a
          // nice-to-have, not the login itself, so don't block signing in.
          console.error(
            `[OAuth:${provider}] identity backfill failed (non-fatal):`,
            err,
          );
        });
    }

    return signInOAuthUser(row.id, ip, userAgent, baseUrl);
  } catch (err) {
    console.error(`[OAuth:${provider}] callback error:`, err);
    return NextResponse.redirect(`${baseUrl}/login?error=oauth_failed`);
  }
}

// Same provider that created/linked the account: log in, honoring 2FA the
// same way a password login would (device-trust bypass, TOTP vs email
// code, everything except the "enter your password" step itself, which
// OAuth already stood in for). Shared by both the provider-id match and
// the email-match paths above -- previously only the latter existed, so
// this was inlined once; now it's needed from two places.
async function signInOAuthUser(
  userId: number,
  ip: string,
  userAgent: string,
  baseUrl: string,
): Promise<NextResponse> {
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

// Google/GitHub account-linking completion. Discord is never routed here --
// [provider]/route.ts's `?action=link` refuses it before a state is ever
// signed, so `provider` is always "google" or "github" in practice, but the
// column lookup below still fails closed (`profileUrl` + oauth_invalid) for
// anything else rather than assuming.
async function handleOAuthLink(
  provider: OAuthProviderId,
  payload: OAuthStatePayload,
  code: string,
  baseUrl: string,
): Promise<NextResponse> {
  const profileUrl = `${baseUrl}/profile?tab=social`;

  if (provider !== "google" && provider !== "github") {
    return NextResponse.redirect(`${profileUrl}&error=oauth_invalid`);
  }

  // The state is bound to the userId of whoever requested the link
  // (route.ts signs it from the session at request time). Re-checking the
  // CURRENT session here, rather than trusting the bound id alone, means a
  // session that logged out (or switched users) mid-flow can't complete a
  // link for someone else's account -- same reasoning as
  // lib/auth/discord-state.ts's userId binding, applied at the point of
  // use instead of only at verification.
  const session = await getSession();
  if (!session || session.userId !== payload.userId) {
    return NextResponse.redirect(`${profileUrl}&error=oauth_session_expired`);
  }

  const redirectUri = `${baseUrl}/api/v3/auth/oauth/${provider}/callback`;

  try {
    const tokens = await exchangeOAuthCode(provider, code, redirectUri);
    if (!tokens) {
      return NextResponse.redirect(`${profileUrl}&error=oauth_token_failed`);
    }

    const userInfo = await fetchOAuthUserInfo(provider, tokens.accessToken);
    if (!userInfo || !userInfo.id) {
      return NextResponse.redirect(`${profileUrl}&error=oauth_user_failed`);
    }
    if (!userInfo.email || !userInfo.emailVerified) {
      return NextResponse.redirect(
        `${profileUrl}&error=oauth_email_unverified`,
      );
    }

    const idColumn = provider === "google" ? "google_id" : "github_id";

    // Reject a re-link that would steal someone else's already-connected
    // identity -- mirror of the sign-up flow's oauth_email_in_use rule
    // above and app/api/v3/auth/discord/callback/route.ts's
    // discord_already_linked check: never silently merge or move an
    // identity between accounts.
    const existing = await pool.query(
      `SELECT id FROM users WHERE ${idColumn} = $1`,
      [userInfo.id],
    );
    if (existing.rows.length > 0 && existing.rows[0].id !== session.userId) {
      const label = OAUTH_PROVIDERS[provider].label;
      const message = `This ${label} account is already connected to a different VulnRadar account.`;
      return NextResponse.redirect(
        `${profileUrl}&error=oauth_already_linked&message=${encodeURIComponent(message)}`,
      );
    }

    try {
      if (provider === "google") {
        await pool.query(
          `UPDATE users SET google_id = $1, google_email = $2, google_name = $3, google_avatar_url = $4 WHERE id = $5`,
          [
            userInfo.id,
            userInfo.email,
            userInfo.name,
            userInfo.avatarUrl,
            session.userId,
          ],
        );
      } else {
        await pool.query(
          `UPDATE users SET github_id = $1, github_email = $2, github_name = $3, github_avatar_url = $4 WHERE id = $5`,
          [
            userInfo.id,
            userInfo.email,
            userInfo.name,
            userInfo.avatarUrl,
            session.userId,
          ],
        );
      }
    } catch (err) {
      // Belt-and-suspenders for the race the SELECT above can't fully
      // close: two concurrent link requests for the same provider
      // identity. The `UNIQUE` constraint on google_id/github_id
      // (instrumentation.ts) is the actual guard; this just turns that
      // into the same user-facing message as the pre-check above instead
      // of a raw 500.
      if ((err as { code?: string }).code === "23505") {
        const label = OAUTH_PROVIDERS[provider].label;
        const message = `This ${label} account is already connected to a different VulnRadar account.`;
        return NextResponse.redirect(
          `${profileUrl}&error=oauth_already_linked&message=${encodeURIComponent(message)}`,
        );
      }
      throw err;
    }

    // GitHub gets the same post-connect sync modal Discord already has
    // (components/modals/github-profile-modal.tsx) -- username/avatar only,
    // never email, matching the reasoning above: no PII in a redirect URL.
    const successUrl = new URL(profileUrl);
    successUrl.searchParams.set(`${provider}_connected`, "true");
    if (provider === "github") {
      if (userInfo.name) {
        successUrl.searchParams.set("github_username", userInfo.name);
      }
      if (userInfo.avatarUrl) {
        successUrl.searchParams.set("github_avatar", userInfo.avatarUrl);
      }
    }
    return NextResponse.redirect(successUrl.toString());
  } catch (err) {
    console.error(`[OAuth:${provider}] link callback error:`, err);
    return NextResponse.redirect(`${profileUrl}&error=oauth_failed`);
  }
}
