import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, STAFF_ROLES, SUBSCRIPTION_PLANS, SUBSCRIPTION_TIERS } from "@/lib/constants"

// Map subscription plan to tier
const planToTier: Record<string, number> = {
  [SUBSCRIPTION_PLANS.FREE]: SUBSCRIPTION_TIERS.FREE,
  [SUBSCRIPTION_PLANS.PRO]: SUBSCRIPTION_TIERS.PRO,
  [SUBSCRIPTION_PLANS.ELITE]: SUBSCRIPTION_TIERS.ELITE,
}

export const PATCH = withErrorHandling(async (req: Request) => {
  const session = await getSession()
  if (!session || session.role !== STAFF_ROLES.ADMIN) {
    return ApiResponse.forbidden(ERROR_MESSAGES.FORBIDDEN)
  }

  const body = await req.json()
  const { userId, plan } = body

  if (!userId || !plan) {
    return ApiResponse.badRequest("userId and plan are required")
  }

  if (!Object.values(SUBSCRIPTION_PLANS).includes(plan)) {
    return ApiResponse.badRequest("Invalid subscription plan")
  }

  const tier = planToTier[plan]

  // Update user's subscription plan and tier
  const result = await pool.query(
    `UPDATE users SET subscription_plan = $1, subscription_tier = $2 WHERE id = $3 RETURNING subscription_plan, subscription_tier`,
    [plan, tier, userId],
  )

  if (result.rows.length === 0) {
    return ApiResponse.notFound("User not found")
  }

  // Log admin action
  await pool.query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, details) VALUES ($1, $2, $3, $4)`,
    [session.userId, userId, "update_subscription", `Changed plan to: ${plan}`],
  )

  return ApiResponse.success({
    subscriptionPlan: result.rows[0].subscription_plan,
    subscriptionTier: result.rows[0].subscription_tier,
  })
})
