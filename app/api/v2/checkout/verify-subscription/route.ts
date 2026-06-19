import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/database/db"
import Stripe from "stripe"

// Initialize Stripe client lazily to avoid issues during build time
function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set")
  }
  return new Stripe(key, {
    apiVersion: "2025-04-30.basil",
  })
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const sessionId = request.nextUrl.searchParams.get("session_id")

    // Get user's current plan from database
    const userResult = await pool.query(
      "SELECT plan, stripe_subscription_id FROM users WHERE id = $1",
      [session.userId]
    )

    if (userResult.rows.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const user = userResult.rows[0]
    const currentPlan = user.plan || "free"

    // If session_id provided, verify it matches the user's subscription
    let sessionVerified = false
    if (sessionId && user.stripe_subscription_id) {
      try {
        const stripe = getStripeClient()
        const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
        if (checkoutSession.subscription === user.stripe_subscription_id) {
          sessionVerified = true
        }
      } catch {
        // Session retrieval failed, but we can still return current plan status
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        plan: currentPlan,
        subscriptionActive: currentPlan !== "free",
        sessionVerified,
      },
    })
  } catch (error) {
    console.error("[Checkout] Verify subscription error:", error)
    return NextResponse.json(
      { error: "Failed to verify subscription" },
      { status: 500 }
    )
  }
}
