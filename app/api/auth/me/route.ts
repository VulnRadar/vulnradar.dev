import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, STAFF_ROLES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // Get user data - use COALESCE to provide defaults for new columns
  const userResult = await pool.query(
    `SELECT totp_enabled, two_factor_method, onboarding_completed, role, avatar_url, backup_codes, 
            COALESCE(subscription_plan, 'FREE') as subscription_plan, 
            COALESCE(subscription_tier, 0) as subscription_tier
     FROM users WHERE id = $1`,
    [session.userId],
  )
  const user = userResult.rows[0]

  // Get user permissions if table exists
  let permissions: string[] = []
  try {
    const permissionsResult = await pool.query(
      `SELECT permission_name FROM user_permissions WHERE user_id = $1`,
      [session.userId],
    )
    permissions = permissionsResult.rows.map((row: any) => row.permission_name)
  } catch (error) {
    // user_permissions table may not exist yet, continue without permissions
    console.log("[v0] user_permissions table not found, continuing without permissions")
  }

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
    subscriptionPlan: user?.subscription_plan || "FREE",
    subscriptionTier: user?.subscription_tier ?? 0,
    permissions: permissions,
    avatarUrl: user?.avatar_url || null,
    onboardingCompleted: user?.onboarding_completed || false,
    backupCodesInvalid,
  })
})
