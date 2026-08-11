import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { getStripe } from "@/lib/billing/stripe";
import { isStaffRole } from "@/lib/auth/permissions-client";

// POST /api/v3/billing/subscription/cancel - Cancel user's subscription
export async function POST(request: NextRequest) {
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
    const { immediate } = await request.json();

    // Get user's subscription
    const userResult = await pool.query(
      `SELECT plan, role, stripe_subscription_id FROM users WHERE id = $1`,
      [session.userId],
    );
    const user = userResult.rows[0];

    if (!user?.stripe_subscription_id) {
      // No subscription ID on file at all -- there is nothing to cancel in
      // Stripe. But if `plan` is still something other than free (a stale
      // value left behind by e.g. a database migration, or any other path
      // that cleared stripe_subscription_id without also resetting plan --
      // see the matching fix in GET /api/v3/billing's resource_missing
      // handler), the account is stuck showing paid access it can never
      // reach the normal cancel flow for, since that flow requires a
      // subscription ID to act on. Correct it here too rather than just
      // 404ing and leaving the account wrong.
      //
      // Skip this correction entirely for a staff account: a real,
      // non-Stripe granted plan with no subscription ID (see
      // lib/billing/staff-plan.ts) is now an intentional, valid state, not
      // a stale one to reset to free.
      if (user?.plan && user.plan !== "free" && !isStaffRole(user.role)) {
        await pool.query(
          `UPDATE users SET plan = 'free', subscription_status = NULL WHERE id = $1`,
          [session.userId],
        );
      }
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 404 },
      );
    }

    // Cancel the subscription
    if (immediate) {
      // Immediate cancellation - set cancel_at to now
      const now = Math.floor(Date.now() / 1000);
      await stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at: now,
      });

      // Update database - set subscription status to canceled and clear
      // subscription ID. billing: a staff account (lib/billing/staff-plan.ts)
      // already holds a real, granted pro_supporter floor -- canceling a
      // real paid subscription on top of that (e.g. Elite they bought
      // themselves) lands back on that floor, not all the way to free.
      await pool.query(
        `UPDATE users SET
          plan = CASE WHEN role IN ('admin', 'moderator', 'support') THEN 'pro_supporter' ELSE 'free' END,
          subscription_status = 'canceled',
          stripe_subscription_id = NULL
        WHERE id = $1`,
        [session.userId],
      );
    } else {
      // Cancel at period end
      await stripe.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true,
      });

      // Update database - set subscription status to canceled
      await pool.query(
        `UPDATE users SET subscription_status = 'canceled' WHERE id = $1`,
        [session.userId],
      );
    }

    return NextResponse.json({
      success: true,
      message: immediate
        ? "Subscription canceled immediately"
        : "Subscription will be canceled at period end",
    });
  } catch (error) {
    console.error("[Billing] Error canceling subscription:", error);
    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 },
    );
  }
}
