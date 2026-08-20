import { type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  ERROR_MESSAGES,
  STAFF_ROLES,
  BEARER_PREFIX,
} from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Bearer token path: used by the browser extension and API clients.
  // Session cookie path below handles the web dashboard.
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(BEARER_PREFIX.length);
    const keyData = await validateApiKey(token);
    if (!keyData) {
      return ApiResponse.unauthorized("Invalid or revoked API key.");
    }
    if (keyData.needsTermsAcceptance) {
      return ApiResponse.forbidden(
        "Please accept the updated Terms of Service before using the API.",
      );
    }
    const [userResult, giftResult] = await Promise.all([
      pool.query(
        "SELECT totp_enabled, two_factor_method, role, avatar_url, plan, scans_private_by_default FROM users WHERE id = $1",
        [keyData.userId],
      ),
      pool.query(
        "SELECT plan FROM gifted_subscriptions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()",
        [keyData.userId],
      ),
    ]);
    const user = userResult.rows[0];
    const effectivePlan = giftResult.rows[0]?.plan || user?.plan || "free";
    // Real, admin-configurable limit (lib/billing/plan-limits.ts), not a
    // static copy of the marketing plan table -- the dashboard's bulk-scan
    // form uses this to cap URL entry at what the caller's plan actually
    // allows, so the pricing page's "URLs per bulk request" row can never
    // silently drift from what the UI itself enforces.
    const keyPlanLimits = await getUserPlanLimits(keyData.userId);
    return ApiResponse.success({
      userId: keyData.userId,
      email: keyData.email,
      name: keyData.userName || null,
      plan: effectivePlan,
      role: user?.role || STAFF_ROLES.USER,
      totpEnabled: user?.totp_enabled || false,
      twoFactorMethod: user?.two_factor_method || null,
      avatarUrl: user?.avatar_url || null,
      scansPrivateByDefault: user?.scans_private_by_default || false,
      bulkScanUrls: keyPlanLimits?.bulkScanUrls ?? -1,
    });
  }

  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // Get 2FA, role, onboarding status, backup codes, badges, discord, billing
  // info (including gifted subscription), and the live terms-of-service
  // settings TosGate needs to decide whether to show the re-accept prompt.
  // Resolved through the runtime config (database, then env, then the
  // shipped default) rather than the build-time CONFIG_ constant, so an
  // admin's edit to the terms date/summary takes effect on the next request.
  const [
    userResult,
    badgesResult,
    giftResult,
    discordResult,
    termsSettings,
    planLimits,
  ] = await Promise.all([
    pool.query(
      `SELECT totp_enabled, two_factor_method, onboarding_completed, role, avatar_url,
                backup_codes, plan, subscription_status, discord_id,
                (password_hash IS NOT NULL) AS has_password,
                google_id, google_email, google_name, google_avatar_url,
                github_id, github_email, github_name, github_avatar_url, github_login,
                scans_private_by_default
           FROM users WHERE id = $1`,
      [session.userId],
    ),
    pool.query(
      `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, ub.awarded_at
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
      [session.userId],
    ),
    pool.query(
      `SELECT plan, expires_at FROM gifted_subscriptions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [session.userId],
    ),
    pool.query(
      `SELECT discord_id, discord_username, discord_avatar FROM discord_connections WHERE user_id = $1`,
      [session.userId],
    ),
    getSettings(["TERMS_UPDATED_AT", "TERMS_CHANGE_SUMMARY"] as const),
    // Real, admin-configurable limit (lib/billing/plan-limits.ts), not a
    // static copy of the marketing plan table -- the dashboard's
    // bulk-scan form uses this to cap URL entry at what the caller's
    // plan actually allows, so the pricing page's "URLs per bulk
    // request" row can never silently drift from what the UI enforces.
    getUserPlanLimits(session.userId),
  ]);
  const user = userResult.rows[0];
  const badges = badgesResult.rows;
  const giftedSubscription = giftResult.rows[0] || null;
  const discordConnection = discordResult.rows[0] || null;

  // Effective plan: gifted takes priority over regular plan
  const effectivePlan = giftedSubscription?.plan || user?.plan || "free";

  // Detect if backup codes are old plaintext format (not hashed)
  // Hashed codes contain ":" separator from scrypt format, plaintext codes are like "XXXX-XXXX"
  let backupCodesInvalid = false;
  if (user?.totp_enabled && user?.backup_codes) {
    try {
      const codes: string[] = JSON.parse(user.backup_codes);
      if (codes.length > 0 && !codes[0].includes(":")) {
        backupCodesInvalid = true;
      }
    } catch {}
  }

  return ApiResponse.success({
    userId: session.userId,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tosAcceptedAt,
    // Set when this session is an active admin-impersonation session (see
    // lib/auth/impersonation.ts) -- drives the impersonation banner.
    isImpersonating: !!session.impersonatedBy,
    termsUpdatedAt: termsSettings.TERMS_UPDATED_AT,
    termsChangeSummary: termsSettings.TERMS_CHANGE_SUMMARY,
    totpEnabled: user?.totp_enabled || false,
    twoFactorMethod: user?.two_factor_method || null,
    role: user?.role || STAFF_ROLES.USER,
    avatarUrl: user?.avatar_url || null,
    // False only for an OAuth-only account (Google/GitHub/Discord sign-up)
    // that never set a password. Drives the "Set a password" vs "Change
    // password" wording in the profile Security tab.
    hasPassword: user?.has_password ?? true,
    onboardingCompleted: user?.onboarding_completed || false,
    backupCodesInvalid,
    // Discord connection
    discordId: discordConnection?.discord_id || user?.discord_id || null,
    discordUsername: discordConnection?.discord_username || null,
    discordAvatar: discordConnection?.discord_avatar || null,
    // Google/GitHub account links (see instrumentation.ts's users columns
    // and app/api/v3/auth/oauth/[provider]/callback/route.ts's
    // handleOAuthLink()). Unlike Discord, no separate `_connections` table
    // -- everything shown for a linked identity lives on this same row.
    googleId: user?.google_id || null,
    googleEmail: user?.google_email || null,
    googleName: user?.google_name || null,
    googleAvatarUrl: user?.google_avatar_url || null,
    githubId: user?.github_id || null,
    githubEmail: user?.github_email || null,
    githubName: user?.github_name || null,
    githubLogin: user?.github_login || null,
    githubAvatarUrl: user?.github_avatar_url || null,
    // Account-level scan privacy default (Privacy tab; see
    // lib/scanner/scan-privacy.ts for how this is applied).
    scansPrivateByDefault: user?.scans_private_by_default || false,
    // Billing/Plan info
    plan: effectivePlan,
    subscriptionStatus: giftedSubscription
      ? "gifted"
      : user?.subscription_status || null,
    giftedSubscription: giftedSubscription
      ? {
          plan: giftedSubscription.plan,
          expiresAt: giftedSubscription.expires_at,
        }
      : null,
    // Real per-plan limit, resolved live -- see the getUserPlanLimits call
    // above. -1 (billing disabled) means unlimited, the same convention
    // every other -1 limit in this codebase uses.
    bulkScanUrls: planLimits?.bulkScanUrls ?? -1,
    // Badges (last for cleaner JSON structure)
    badges,
  });
});
