import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse } from "@/lib/api/api-utils";
import { authenticateApiKey, type ApiKeyAuth } from "@/lib/api/api-key-auth";
import { buildQuotaBlock, type QuotaBlock } from "@/lib/api/quota";
import { ERROR_MESSAGES, STAFF_ROLES } from "@/lib/config/constants";
import { getSettings } from "@/lib/config/runtime-config";
import { getPlanLimitsForPlan, planRank } from "@/lib/billing/plan-limits";
import { resolveEffectivePlan } from "@/lib/rate-limiting/daily-limits";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";

/**
 * GET /auth/me answers two audiences with two bodies: an API key (the
 * browser extension, scripts) gets about a dozen fields about the key's
 * owner, and the signed-in web app gets the thirty-odd it renders from. The
 * route picks one by the Authorization header; v4 and /api/internal will each
 * mount one of these on its own, so neither may read the other's credential.
 */

/**
 * An admin gift must only ever be an upgrade. It used to replace users.plan
 * outright, so gifting a lower tier to a paying customer reported (and
 * enforced, via getUserPlan) the lower plan while Stripe kept charging the
 * higher one. Mirrors the same comparison in getUserPlan and GET /api/v3/billing.
 */
function higherPlan(
  giftedPlan: string | null | undefined,
  userPlan: string | null | undefined,
): string {
  const own = userPlan || "free";
  if (!giftedPlan) return own;
  return planRank(giftedPlan) >= planRank(own) ? giftedPlan : own;
}

/**
 * The quota block costs two aggregate reads, one of them a COUNT(*) over the
 * key's last 24 hours of api_usage (up to about a million rows for an
 * unlimited key), and this is the one key-authenticated endpoint that is not
 * metered. So the block is kept per key for 30 seconds, and the figures may
 * lag by that much. The promise is what is kept, so a burst of identity
 * checks from one key shares a single read instead of each starting one.
 * Bounded so a flood of distinct keys cannot grow the map without limit; the
 * oldest entry goes first.
 */
const QUOTA_CACHE_TTL_MS = 30_000;
const QUOTA_CACHE_MAX_KEYS = 1_000;
const quotaCache = new Map<
  number,
  { expiresAt: number; quota: Promise<QuotaBlock> }
>();

function cachedQuotaBlock(auth: ApiKeyAuth): Promise<QuotaBlock> {
  const now = Date.now();
  const hit = quotaCache.get(auth.keyId);
  if (hit && hit.expiresAt > now) return hit.quota;

  const quota = buildQuotaBlock(auth.userId, {
    keyId: auth.keyId,
    dailyLimit: auth.dailyLimit,
  });
  quotaCache.delete(auth.keyId);
  while (quotaCache.size >= QUOTA_CACHE_MAX_KEYS) {
    const oldest = quotaCache.keys().next();
    if (oldest.done) break;
    quotaCache.delete(oldest.value);
  }
  quotaCache.set(auth.keyId, { expiresAt: now + QUOTA_CACHE_TTL_MS, quota });
  // A failed read must not be served to the next 30 seconds of callers.
  quota.catch(() => {
    if (quotaCache.get(auth.keyId)?.quota === quota) {
      quotaCache.delete(auth.keyId);
    }
  });
  return quota;
}

/** The Bearer half: who this key belongs to, the key itself, and its budgets. */
export async function meForApiKey(request: Request) {
  const key = await authenticateApiKey(request);
  if (!key.ok) return key.response;
  const keyData = key.auth;

  // Per key rather than per account, so one leaked key cannot spend the
  // allowance of its owner's other keys, and before any read: the limiter is
  // what keeps this unmetered endpoint from being a free stream of the
  // aggregate reads the quota block costs.
  const rl = await checkRateLimit({
    key: `auth-me:${keyData.keyId}`,
    ...RATE_LIMITS.authMe,
  });
  if (!rl.allowed) {
    return ApiResponse.fail({
      code: "RATE_LIMITED",
      message: `Too many identity checks with this API key. Try again in ${rl.retryAfterSeconds} second(s).`,
      status: 429,
      retryAfter: rl.retryAfterSeconds,
      request,
    });
  }

  const [userResult, giftResult, quota] = await Promise.all([
    pool.query(
      "SELECT totp_enabled, two_factor_method, role, avatar_url, plan, scans_private_by_default FROM users WHERE id = $1",
      [keyData.userId],
    ),
    pool.query(
      "SELECT plan FROM gifted_subscriptions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()",
      [keyData.userId],
    ),
    cachedQuotaBlock(keyData),
  ]);
  const user = userResult.rows[0];
  // Higher of the gift and the user's own plan, matching getUserPlan. A gift
  // used to win outright, silently reporting a downgrade to a paying user.
  const effectivePlan = higherPlan(giftResult.rows[0]?.plan, user?.plan);
  // Real, admin-configurable limit (lib/billing/plan-limits.ts), not a
  // static copy of the marketing plan table -- the dashboard's bulk-scan
  // form uses this to cap URL entry at what the caller's plan actually
  // allows, so the pricing page's "URLs per bulk request" row can never
  // silently drift from what the UI itself enforces.
  //
  // Resolved from the two rows just read rather than through
  // getUserPlanLimits, which would re-read the same users row joined
  // against the same gifted_subscriptions row to reach the same answer.
  const keyPlanLimits = await getPlanLimitsForPlan(
    resolveEffectivePlan({
      plan: user?.plan,
      role: user?.role,
      gifted_plan: giftResult.rows[0]?.plan,
    }),
  );
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
    // The key that answered, so a client can show which one it holds and
    // what it may do without a second call.
    key: { id: keyData.keyId, name: keyData.keyName, scopes: keyData.scopes },
    // Where the caller stands on the daily scans and on this key's request
    // budget. Reading it spends neither.
    quota,
  });
}

/**
 * The session half: the signed-in web app's view of its own account. Never
 * reads the Authorization header, so a stray Bearer header from a browser
 * extension cannot change which account it describes.
 */
export async function meForSession() {
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
  const [userResult, badgesResult, giftResult, discordResult, termsSettings] =
    await Promise.all([
      pool.query(
        `SELECT totp_enabled, two_factor_method, onboarding_completed, role, avatar_url,
                backup_codes, plan, subscription_status,
                discord_id, discord_username, discord_avatar_url,
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
    ]);
  const user = userResult.rows[0];
  const badges = badgesResult.rows;
  const giftedSubscription = giftResult.rows[0] || null;
  const discordConnection = discordResult.rows[0] || null;

  // Effective plan: the HIGHER of the gift and the user's own plan, not the
  // gift unconditionally. See higherPlan above.
  const effectivePlan = higherPlan(giftedSubscription?.plan, user?.plan);

  // Real, admin-configurable limit (lib/billing/plan-limits.ts), not a static
  // copy of the marketing plan table -- the dashboard's bulk-scan form uses
  // this to cap URL entry at what the caller's plan actually allows, so the
  // pricing page's "URLs per bulk request" row can never silently drift from
  // what the UI enforces.
  //
  // Resolved from the two rows already read above. This route runs on every
  // page load, and going through getUserPlanLimits made it re-read the same
  // users row joined against the same gifted_subscriptions row (a third read
  // of that users row, counting getSession's) to compute an answer both rows
  // were already in hand for.
  const planLimits = await getPlanLimitsForPlan(
    resolveEffectivePlan({
      plan: user?.plan,
      role: user?.role,
      gifted_plan: giftedSubscription?.plan,
    }),
  );

  // Detect if backup codes are old plaintext format (not hashed)
  // Hashed codes contain ":" separator from scrypt format, plaintext codes are like "XXXX-XXXX"
  let backupCodesInvalid = false;
  if (user?.totp_enabled && user?.backup_codes) {
    try {
      const codes: string[] = JSON.parse(user.backup_codes);
      if (codes.length > 0 && !codes[0].includes(":")) {
        backupCodesInvalid = true;
      }
    } catch (err) {
      // Unparseable is not the same as fine. This column is written as JSON
      // by our own code, so a value that will not parse is a value nobody
      // can redeem, and swallowing it told an account with 2FA enabled that
      // its recovery codes were in order. The account holder would discover
      // otherwise at exactly the moment the codes are for: locked out.
      backupCodesInvalid = true;
      console.error(
        `[AUTH-ME] backup_codes for user ${session.userId} could not be parsed; flagging for regeneration:`,
        err,
      );
    }
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
    // Discord. Two distinct flows land here and only one of them writes to
    // discord_connections: signing in with Discord writes discord_id,
    // discord_username and discord_avatar_url onto the users row
    // (lib/auth/auth.ts's OAUTH_IDENTITY_COLUMNS), while the "join our
    // server" connection writes the separate table. `discordId` already fell
    // back to the users row; the name and avatar did not, so a
    // Discord-created account rendered as a nameless, faceless "Connected".
    discordId: discordConnection?.discord_id || user?.discord_id || null,
    discordUsername:
      discordConnection?.discord_username || user?.discord_username || null,
    // A CDN avatar *hash*, only ever present on the connection row. The
    // users row stores a whole URL instead, so the two cannot share a field.
    discordAvatar: discordConnection?.discord_avatar || null,
    discordAvatarUrl: user?.discord_avatar_url || null,
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
    // Real per-plan limit, resolved live -- see the getPlanLimitsForPlan call
    // above. -1 (billing disabled) means unlimited, the same convention
    // every other -1 limit in this codebase uses.
    bulkScanUrls: planLimits?.bulkScanUrls ?? -1,
    // Active API keys the plan allows, from the same live resolve, so the
    // Developer tab's "N of M" and its Create button agree with what
    // POST /keys enforces after an admin edits the limit, a gift, or a staff
    // role. The plan catalog the tab used to read is the shipped default.
    apiKeys: planLimits?.apiKeys ?? -1,
    // Badges (last for cleaner JSON structure)
    badges,
  });
}
