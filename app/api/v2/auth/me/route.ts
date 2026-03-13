import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, STAFF_ROLES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // Get 2FA, role, onboarding status, backup codes, badges, discord, and billing info (including gifted subscription)
  const [userResult, badgesResult, giftResult, discordResult] = await Promise.all([
    pool.query(
      "SELECT totp_enabled, two_factor_method, onboarding_completed, role, avatar_url, backup_codes, plan, subscription_status, discord_id FROM users WHERE id = $1",
      [session.userId],
    ),
    pool.query(
      `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, ub.awarded_at
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
      [session.userId]
    ),
    pool.query(
      `SELECT plan, expires_at FROM gifted_subscriptions 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [session.userId]
    ),
    pool.query(
      `SELECT discord_id, discord_username, discord_avatar FROM discord_connections WHERE user_id = $1`,
      [session.userId]
    )
  ])
  const user = userResult.rows[0]
  const badges = badgesResult.rows
  const giftedSubscription = giftResult.rows[0] || null
  const discordConnection = discordResult.rows[0] || null
  
  // Effective plan: gifted takes priority over regular plan
  const effectivePlan = giftedSubscription?.plan || user?.plan || "free"

  // Detect if backup codes are old plaintext format (not hashed)
  // Hashed codes contain ":" separator from scrypt format, plaintext codes are like "XXXX-XXXX"
  let backupCodesInvalid = false
  if (user?.totp_enabled && user?.backup_codes) {
    try {
      const codes: string[] = JSON.parse(user.backup_codes)
      if (codes.length > 0 && !codes[0].includes(":")) {
        backupCodesInvalid = true
      }
    } catch {}
  }

  return ApiResponse.success({
    userId: session.userId,
    email: session.email,
    name: session.name,
    tosAcceptedAt: session.tosAcceptedAt,
    totpEnabled: user?.totp_enabled || false,
    twoFactorMethod: user?.two_factor_method || null,
    isAdmin: user?.role === STAFF_ROLES.ADMIN,
    role: user?.role || STAFF_ROLES.USER,
    avatarUrl: user?.avatar_url || null,
    onboardingCompleted: user?.onboarding_completed || false,
    backupCodesInvalid,
    // Discord connection
    discordId: discordConnection?.discord_id || user?.discord_id || null,
    discordUsername: discordConnection?.discord_username || null,
    discordAvatar: discordConnection?.discord_avatar || null,
    // Billing/Plan info
    plan: effectivePlan,
    subscriptionStatus: giftedSubscription ? "gifted" : (user?.subscription_status || null),
    giftedSubscription: giftedSubscription ? {
      plan: giftedSubscription.plan,
      expiresAt: giftedSubscription.expires_at,
    } : null,
    // Badges (last for cleaner JSON structure)
    badges,
  })
})
