import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  // Get 2FA, role, onboarding status, and backup codes
  const result = await pool.query(
    "SELECT totp_enabled, onboarding_completed, role, avatar_url, backup_codes FROM users WHERE id = $1",
    [session.userId],
  )
  const user = result.rows[0]

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
    isAdmin: user?.role === "admin",
    role: user?.role || "user",
    avatarUrl: user?.avatar_url || null,
    onboardingCompleted: user?.onboarding_completed || false,
    backupCodesInvalid,
  })
})
