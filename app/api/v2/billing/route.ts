// ============================================================================
// Billing API - Usage tracking and subscription management
// ============================================================================

import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { stripe } from "@/lib/stripe"
import { canMakeRequest, PLAN_LIMITS, type PlanType } from "@/lib/daily-limits"
import { BILLING_ENABLED } from "@/lib/constants"

// GET /api/v2/billing - Get user's billing info and usage
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // Get user's plan and subscription info
    const userResult = await pool.query(
      `SELECT plan, subscription_status, stripe_customer_id, stripe_subscription_id, role 
       FROM users WHERE id = $1`,
      [session.userId]
    )
    
    const user = userResult.rows[0]
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check for gifted subscription first (before calculating limits)
    const giftResult = await pool.query(
      `SELECT plan, expires_at, created_at FROM gifted_subscriptions 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [session.userId]
    )
    const giftedSubscription = giftResult.rows[0] || null

    // Get usage info (this already checks gifted subscriptions internally)
    const usageInfo = await canMakeRequest(session.userId)
    
    // Determine plan type for limits - gifted plan takes priority
    const effectivePlanType: PlanType = user.role === "admin" 
      ? "admin" 
      : (giftedSubscription?.plan || user.plan || "free")
    const dailyLimit = PLAN_LIMITS[effectivePlanType] || PLAN_LIMITS.free

    // Get subscription details from Stripe if user has one
    let subscriptionDetails = null
    if (user.stripe_subscription_id) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id)
        // Only set subscription details if the subscription is valid and has period data
        if (subscription && subscription.current_period_start && subscription.current_period_end) {
          subscriptionDetails = {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            cancelAt: subscription.cancel_at 
              ? new Date(subscription.cancel_at * 1000).toISOString() 
              : null,
          }
        } else {
          console.warn("[Billing] Subscription exists but has no period data:", subscription?.id)
        }
      } catch (stripeErr: unknown) {
        console.error("[Billing] Error fetching subscription from Stripe:", stripeErr)
        // If the subscription doesn't exist in Stripe, clear it from the database
        if (stripeErr && typeof stripeErr === "object" && "code" in stripeErr && stripeErr.code === "resource_missing") {
          console.warn("[Billing] Clearing orphaned subscription ID from database")
          await pool.query(
            `UPDATE users SET stripe_subscription_id = NULL, subscription_status = NULL WHERE id = $1`,
            [session.userId]
          )
        }
      }
    }

    // Determine the effective plan (gifted takes priority if active)
    const effectivePlan = giftedSubscription ? giftedSubscription.plan : (user.plan || "free")

    return NextResponse.json({
      billingEnabled: BILLING_ENABLED,
      plan: effectivePlan,
      subscriptionStatus: giftedSubscription ? "gifted" : user.subscription_status,
      stripeCustomerId: user.stripe_customer_id,
      subscription: subscriptionDetails,
      giftedSubscription: giftedSubscription ? {
        plan: giftedSubscription.plan,
        expiresAt: giftedSubscription.expires_at,
        startedAt: giftedSubscription.created_at,
      } : null,
      usage: {
        used: usageInfo.used,
        limit: dailyLimit === Infinity ? -1 : dailyLimit,
        remaining: dailyLimit === Infinity ? -1 : usageInfo.remaining,
        resetsAt: usageInfo.resetsAt,
        unlimited: dailyLimit === Infinity || !BILLING_ENABLED,
      },
      limits: {
        free: PLAN_LIMITS.free,
        core_supporter: PLAN_LIMITS.core_supporter,
        pro_supporter: PLAN_LIMITS.pro_supporter,
        elite_supporter: PLAN_LIMITS.elite_supporter,
      },
    })
  } catch (error) {
    console.error("[Billing] Error fetching billing info:", error)
    return NextResponse.json({ error: "Failed to fetch billing info" }, { status: 500 })
  }
}

// POST /api/v2/billing - Cancel subscription
export async function POST(request: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { action } = body

    if (action === "cancel") {
      // Get user's subscription ID (or customer ID to look it up)
      const userResult = await pool.query(
        `SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1`,
        [session.userId]
      )
      
      let subscriptionId = userResult.rows[0]?.stripe_subscription_id
      const customerId = userResult.rows[0]?.stripe_customer_id
      
      // If no subscription ID but we have a customer ID, try to find the subscription
      if (!subscriptionId && customerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        })
        if (subscriptions.data.length > 0) {
          subscriptionId = subscriptions.data[0].id
          // Update the database with the found subscription ID
          await pool.query(
            `UPDATE users SET stripe_subscription_id = $1 WHERE id = $2`,
            [subscriptionId, session.userId]
          )
        }
      }
      
      if (!subscriptionId) {
        return NextResponse.json({ error: "No active subscription found" }, { status: 400 })
      }

      // Cancel at period end (user keeps access until billing period ends)
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      })

      // Update user's subscription status in database
      await pool.query(
        `UPDATE users SET subscription_status = 'canceling' WHERE id = $1`,
        [session.userId]
      )

      return NextResponse.json({
        success: true,
        message: "Subscription will be canceled at the end of the billing period",
        cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
      })
    }

    if (action === "cancel_immediately") {
      // Get user's subscription ID (or customer ID to look it up)
      const userResult = await pool.query(
        `SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1`,
        [session.userId]
      )
      
      let subscriptionId = userResult.rows[0]?.stripe_subscription_id
      const customerId = userResult.rows[0]?.stripe_customer_id
      
      // If no subscription ID but we have a customer ID, try to find the subscription
      if (!subscriptionId && customerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        })
        if (subscriptions.data.length > 0) {
          subscriptionId = subscriptions.data[0].id
        }
      }
      
      if (!subscriptionId) {
        return NextResponse.json({ error: "No active subscription found" }, { status: 400 })
      }

      // Cancel immediately (user loses access now)
      await stripe.subscriptions.cancel(subscriptionId)

      // Update user's plan and subscription status in database
      await pool.query(
        `UPDATE users SET plan = 'free', subscription_status = 'canceled', stripe_subscription_id = NULL WHERE id = $1`,
        [session.userId]
      )

      return NextResponse.json({
        success: true,
        message: "Subscription canceled immediately",
      })
    }

    if (action === "reactivate") {
      // Get user's subscription ID
      const userResult = await pool.query(
        `SELECT stripe_subscription_id FROM users WHERE id = $1`,
        [session.userId]
      )
      
      const subscriptionId = userResult.rows[0]?.stripe_subscription_id
      if (!subscriptionId) {
        return NextResponse.json({ error: "No subscription found" }, { status: 400 })
      }

      // Remove cancel at period end
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      })

      // Update user's subscription status
      await pool.query(
        `UPDATE users SET subscription_status = 'active' WHERE id = $1`,
        [session.userId]
      )

      return NextResponse.json({
        success: true,
        message: "Subscription reactivated",
      })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("[Billing] Error processing billing action:", error)
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 })
  }
}
