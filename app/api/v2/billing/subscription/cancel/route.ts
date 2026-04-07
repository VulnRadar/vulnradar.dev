import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/database/db"
import { stripe } from "@/lib/billing/stripe"

// POST /api/v2/billing/subscription/cancel - Cancel user's subscription
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { immediate } = await request.json()

    // Get user's subscription
    const userResult = await pool.query(
      `SELECT stripe_subscription_id FROM users WHERE id = $1`,
      [session.userId]
    )
    const user = userResult.rows[0]

    if (!user?.stripe_subscription_id) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    // Cancel the subscription
    if (immediate) {
      // Immediate cancellation - set cancel_at to now
      const now = Math.floor(Date.now() / 1000)
      await stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at: now,
      })

      // Update database - set subscription status to canceled and clear subscription ID
      await pool.query(
        `UPDATE users SET plan = 'free', subscription_status = 'canceled', stripe_subscription_id = NULL WHERE id = $1`,
        [session.userId]
      )
    } else {
      // Cancel at period end
      await stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true,
      })

      // Update database - set subscription status to canceled
      await pool.query(
        `UPDATE users SET subscription_status = 'canceled' WHERE id = $1`,
        [session.userId]
      )
    }

    return NextResponse.json({
      success: true,
      message: immediate ? "Subscription canceled immediately" : "Subscription will be canceled at period end",
    })
  } catch (error) {
    console.error("[Billing] Error canceling subscription:", error)
    return NextResponse.json({ error: "Failed to cancel subscription" }, { status: 500 })
  }
}

