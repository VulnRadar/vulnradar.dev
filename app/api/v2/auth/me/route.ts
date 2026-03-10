import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, STAFF_ROLES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // Get 2FA, role, onboarding status, backup codes, badges, and billing info
  const [userResult, badgesResult] = await Promise.all([
    pool.query(
      "SELECT totp_enabled, two_factor_method, onboarding_completed, role, avatar_url, backup_codes, plan, subscription_status, subscription_current_period_end FROM users WHERE id = $1",
      [session.userId],
    ),
    pool.query(
      `SELECT b.id, b.name, b.display_name, b.description, b.icon, b.color, b.priority, ub.awarded_at
       FROM user_badges ub JOIN badges b ON ub.badge_id = b.id
       WHERE ub.user_id = $1 ORDER BY b.priority DESC`,
      [session.userId]
    )
  ])
  const user = userResult.rows[0]
  const badges = badgesResult.rows

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
    badges,
    // Billing/Plan info
    plan: user?.plan || "free",
    subscriptionStatus: user?.subscription_status || null,
    subscriptionCurrentPeriodEnd: user?.subscription_current_period_end || null,
  })
})
