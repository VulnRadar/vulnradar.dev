import { NextRequest, NextResponse } from "next/server"
import pool from "@/lib/db"

const CRON_SECRET = process.env.CRON_SECRET || ""

export async function POST(request: NextRequest) {
  // Verify cron secret
  const secret = request.headers.get("X-Cron-Secret")
  if (secret !== CRON_SECRET || !CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  try {
    // Find all expired gifted subscriptions that haven't been processed yet
    const expiredGifts = await pool.query(`
      SELECT gs.id, gs.user_id, gs.plan
      FROM gifted_subscriptions gs
      WHERE gs.expires_at <= NOW() AND gs.expires_at > NOW() - INTERVAL '1 hour'
      AND gs.updated_at < gs.expires_at
    `)

    let processedCount = 0

    for (const gift of expiredGifts.rows) {
      const { id, user_id, plan } = gift

      // Check if user has an active Stripe subscription
      const stripeSubscription = await pool.query(`
        SELECT plan FROM subscriptions
        WHERE user_id = $1 
        AND stripe_subscription_id IS NOT NULL 
        AND cancel_at_period_end = FALSE 
        AND current_period_end > NOW()
      `, [user_id])

      // If they have a Stripe subscription, keep that plan; otherwise revert to free
      let newPlan = "free"
      if (stripeSubscription.rows[0]) {
        newPlan = stripeSubscription.rows[0].plan
      }

      // Update user plan
      await pool.query(
        `UPDATE users 
         SET plan = $1, subscription_status = $2, updated_at = NOW() 
         WHERE id = $3`,
        [newPlan, newPlan === "free" ? null : "active", user_id]
      )

      // Mark gift as processed by updating the updated_at to now
      await pool.query(
        `UPDATE gifted_subscriptions 
         SET updated_at = NOW() 
         WHERE id = $1`,
        [id]
      )

      processedCount++
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${processedCount} expired gifted subscriptions`,
      processedCount,
    })
  } catch (error) {
    console.error("[Cron] Error expiring gifts:", error)
    return NextResponse.json({
      error: "Failed to process expired gifts",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 })
  }
}
