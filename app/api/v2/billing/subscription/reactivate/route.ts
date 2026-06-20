import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { getStripe } from "@/lib/billing/stripe";

// POST /api/v2/billing/subscription/reactivate - Reactivate user's subscription
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 },
    );
  }

  try {
    // Get user's subscription
    const userResult = await pool.query(
      `SELECT stripe_subscription_id FROM users WHERE id = $1`,
      [session.userId],
    );
    const user = userResult.rows[0];

    if (!user?.stripe_subscription_id) {
      return NextResponse.json(
        { error: "No subscription found" },
        { status: 404 },
      );
    }

    // Reactivate the subscription by removing the cancel_at_period_end flag
    await stripe.subscriptions.update(user.stripe_subscription_id, {
      cancel_at_period_end: false,
    });

    // Update database - set subscription status back to active
    await pool.query(
      `UPDATE users SET subscription_status = 'active' WHERE id = $1`,
      [session.userId],
    );

    return NextResponse.json({
      success: true,
      message: "Subscription reactivated successfully",
    });
  } catch (error) {
    console.error("[Billing] Error reactivating subscription:", error);
    return NextResponse.json(
      { error: "Failed to reactivate subscription" },
      { status: 500 },
    );
  }
}
