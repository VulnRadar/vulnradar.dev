// ============================================================================
// Billing API - Usage tracking and subscription management

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { getStripe } from "@/lib/billing/stripe";
import { canMakeRequest } from "@/lib/rate-limiting/daily-limits";
import { getSetting, getSettings } from "@/lib/config/runtime-config";
import { checkAiUsageQuota } from "@/lib/billing/ai-usage";
import { checkGithubReviewQuota } from "@/lib/billing/github-review-usage";
import { checkBrowserbaseQuota } from "@/lib/billing/browserbase-usage";
import { isStaffRole } from "@/lib/auth/permissions-client";
import { planRank } from "@/lib/billing/plan-limits";
import {
  staffPlanFloorCase,
  STAFF_PLAN_FLOOR_ROLES,
} from "@/lib/billing/staff-plan";

// GET /api/v3/billing - Get user's billing info and usage
export async function GET() {
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
    // Get user's plan and subscription info
    const userResult = await pool.query(
      `SELECT plan, subscription_status, stripe_customer_id, stripe_subscription_id, role 
       FROM users WHERE id = $1`,
      [session.userId],
    );

    const user = userResult.rows[0];
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check for gifted subscription first (before calculating limits)
    const giftResult = await pool.query(
      `SELECT plan, expires_at, created_at FROM gifted_subscriptions 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
      [session.userId],
    );
    const giftedSubscription = giftResult.rows[0] || null;

    // Get usage info (this already checks gifted subscriptions internally,
    // and already resolves the live, admin-configurable per-plan limit
    // through getDailyLimit -- reuse its numbers below instead of
    // recomputing them from the static PLAN_LIMITS fallback table, which
    // would silently drift from an admin's edits in /admin).
    const usageInfo = await canMakeRequest(session.userId);
    const billingEnabled = await getSetting("BILLING_ENABLED");
    // AI finding verification only -- see the aiUsage field's own doc
    // comment in components/profile/types.ts for why chat/summary aren't
    // part of this number.
    const aiQuota = await checkAiUsageQuota(session.userId);
    const aiWindowResetsAt = new Date(
      aiQuota.windowStart.getTime() + aiQuota.windowHours * 60 * 60 * 1000,
    ).toISOString();
    // GitHub repo AI code review -- same fixed window as aiQuota above
    // (see lib/billing/github-review-usage.ts), its own separate cap.
    const githubReviewQuota = await checkGithubReviewQuota(session.userId);
    const githubReviewWindowResetsAt = new Date(
      githubReviewQuota.windowStart.getTime() +
        githubReviewQuota.windowHours * 60 * 60 * 1000,
    ).toISOString();
    // Live-browser (Browserbase) session minutes -- resets monthly, not on
    // the fixed AI_USAGE_WINDOW_HOURS window the two quotas above share.
    const browserbaseQuota = await checkBrowserbaseQuota(session.userId);
    const browserbasePeriodResetsAt = new Date(
      Date.UTC(
        browserbaseQuota.periodStart.getUTCFullYear(),
        browserbaseQuota.periodStart.getUTCMonth() + 1,
        1,
      ),
    ).toISOString();
    // billing: the four plan daily-scan caps shown on the pricing/usage
    // card, resolved live so an admin edit shows up here instead of the
    // shipped defaults.
    const resolvedScanLimits = await getSettings([
      "BILLING_FREE_LIMIT",
      "BILLING_CORE_SUPPORTER_LIMIT",
      "BILLING_PRO_SUPPORTER_LIMIT",
      "BILLING_ELITE_SUPPORTER_LIMIT",
    ] as const);
    const planDailyScanLimits = {
      free: resolvedScanLimits.BILLING_FREE_LIMIT,
      core_supporter: resolvedScanLimits.BILLING_CORE_SUPPORTER_LIMIT,
      pro_supporter: resolvedScanLimits.BILLING_PRO_SUPPORTER_LIMIT,
      elite_supporter: resolvedScanLimits.BILLING_ELITE_SUPPORTER_LIMIT,
    };

    // Get subscription details from Stripe if user has one
    let subscriptionDetails = null;
    if (user.stripe_subscription_id) {
      try {
        const subscription = await stripe.subscriptions.retrieve(
          user.stripe_subscription_id,
          {
            expand: [
              "default_payment_method",
              "latest_invoice",
              "customer",
              "plan",
              "items.data.price.product",
            ],
          },
        );

        // Only set subscription details if the subscription is valid and has items with period data
        const item = subscription.items?.data?.[0];
        const itemPeriodStart = item?.current_period_start;
        const itemPeriodEnd = item?.current_period_end;

        if (subscription && itemPeriodStart && itemPeriodEnd) {
          const priceAmount = item?.price?.unit_amount
            ? item.price.unit_amount / 100
            : null;
          const priceCurrency = item?.price?.currency || "usd";
          const priceInterval = item?.price?.recurring?.interval || null;
          const priceIntervalCount =
            item?.price?.recurring?.interval_count || 1;

          // Get payment method details
          const paymentMethod = subscription.default_payment_method as {
            card?: {
              brand: string;
              last4: string;
              exp_month: number;
              exp_year: number;
            };
          } | null;
          const cardBrand = paymentMethod?.card?.brand || null;
          const cardLast4 = paymentMethod?.card?.last4 || null;
          const cardExpMonth = paymentMethod?.card?.exp_month || null;
          const cardExpYear = paymentMethod?.card?.exp_year || null;

          // Get latest invoice info
          const latestInvoice = subscription.latest_invoice as {
            amount_paid?: number;
            status?: string;
            paid?: boolean;
            created?: number;
          } | null;

          subscriptionDetails = {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(itemPeriodStart * 1000).toISOString(),
            currentPeriodEnd: new Date(itemPeriodEnd * 1000).toISOString(),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            cancelAt: subscription.cancel_at
              ? new Date(subscription.cancel_at * 1000).toISOString()
              : null,
            // Additional details
            priceAmount,
            priceCurrency,
            priceInterval,
            priceIntervalCount,
            // Payment method info
            cardBrand,
            cardLast4,
            cardExpMonth,
            cardExpYear,
            // Invoice info
            lastPaymentAmount: latestInvoice?.amount_paid
              ? latestInvoice.amount_paid / 100
              : null,
            lastPaymentStatus: latestInvoice?.status || null,
            lastPaymentDate: latestInvoice?.created
              ? new Date(latestInvoice.created * 1000).toISOString()
              : null,
            // Computed: next billing date is itemPeriodEnd unless canceling
            nextBillingDate: subscription.cancel_at_period_end
              ? null
              : new Date(itemPeriodEnd * 1000).toISOString(),
          };
        } else {
          console.warn(
            "[Billing] Subscription exists but has no period data:",
            subscription?.id,
          );
          console.warn(
            "[Billing] item?.current_period_start:",
            item?.current_period_start,
          );
          console.warn(
            "[Billing] item?.current_period_end:",
            item?.current_period_end,
          );
          console.warn(
            "[Billing] subscription.items.data length:",
            subscription.items?.data?.length,
          );
        }
      } catch (stripeErr: unknown) {
        console.error(
          "[Billing] Error fetching subscription from Stripe:",
          stripeErr,
        );
        // If the subscription doesn't exist in Stripe (a dangling ID left
        // behind by e.g. a database migration from a different Stripe
        // account/mode), clear it AND downgrade the plan -- matching what
        // the "cancel_immediately" action below already does for a real
        // cancellation. Previously this only cleared
        // stripe_subscription_id/subscription_status and left `plan`
        // untouched, so a user whose subscription no longer exists in
        // Stripe at all kept whatever paid plan they had forever, with no
        // webhook ever able to fire for a subscription ID Stripe doesn't
        // recognize.
        if (
          stripeErr &&
          typeof stripeErr === "object" &&
          "code" in stripeErr &&
          stripeErr.code === "resource_missing"
        ) {
          // billing: a staff account (lib/billing/staff-plan.ts) already
          // holds a real, granted pro_supporter floor -- a dangling
          // subscription reference clears back to that floor, not all the
          // way to free, same as every other cancel/lapse path.
          const fallbackPlan = isStaffRole(user.role)
            ? "pro_supporter"
            : "free";
          console.warn(
            `[Billing] Clearing orphaned subscription and downgrading to ${fallbackPlan}`,
          );
          await pool.query(
            `UPDATE users SET plan = $1, stripe_subscription_id = NULL, subscription_status = NULL WHERE id = $2`,
            [fallbackPlan, session.userId],
          );
          // Reflect the downgrade in this same response instead of only
          // the database -- effectivePlan below reads from this in-memory
          // object, not a fresh query.
          user.plan = fallbackPlan;
          user.subscription_status = null;
          user.stripe_subscription_id = null;
        }
      }
    }

    // Effective plan: the HIGHER of the gift and the user's own plan, matching
    // getUserPlan (lib/rate-limiting/daily-limits.ts). A gift used to win
    // outright, so a paying Elite customer who was gifted a lower tier saw the
    // lower plan reported here while still being charged for Elite.
    const effectivePlan =
      giftedSubscription &&
      planRank(giftedSubscription.plan) >= planRank(user.plan || "free")
        ? giftedSubscription.plan
        : user.plan || "free";

    return NextResponse.json({
      billingEnabled,
      plan: effectivePlan,
      subscriptionStatus: giftedSubscription
        ? "gifted"
        : user.subscription_status,
      stripeCustomerId: user.stripe_customer_id,
      subscription: subscriptionDetails,
      giftedSubscription: giftedSubscription
        ? {
            plan: giftedSubscription.plan,
            expiresAt: giftedSubscription.expires_at,
            startedAt: giftedSubscription.created_at,
          }
        : null,
      usage: {
        used: usageInfo.used,
        limit: usageInfo.limit,
        remaining: usageInfo.remaining,
        resetsAt: usageInfo.resetsAt,
        unlimited: usageInfo.limit === -1 || !billingEnabled,
      },
      limits: planDailyScanLimits,
      aiUsage: {
        used: aiQuota.usedTokens,
        limit: aiQuota.limitTokens,
        resetsAt: aiWindowResetsAt,
        windowHours: aiQuota.windowHours,
        unlimited: aiQuota.limitTokens === -1,
        usingOwnAi: aiQuota.usingOwnAi,
        creditBalance: aiQuota.creditBalance,
      },
      githubReviewUsage: {
        used: githubReviewQuota.usedTokens,
        limit: githubReviewQuota.limitTokens,
        resetsAt: githubReviewWindowResetsAt,
        windowHours: githubReviewQuota.windowHours,
        unlimited: githubReviewQuota.limitTokens === -1,
        usingOwnAi: githubReviewQuota.usingOwnAi,
        creditBalance: githubReviewQuota.creditBalance,
      },
      browserbaseUsage: {
        usedSeconds: browserbaseQuota.usedSeconds,
        limitMinutes: browserbaseQuota.limitMinutes,
        resetsAt: browserbasePeriodResetsAt,
        unlimited: browserbaseQuota.limitMinutes === -1,
        creditBalanceSeconds: browserbaseQuota.creditBalanceSeconds,
      },
    });
  } catch (error) {
    console.error("[Billing] Error fetching billing info:", error);
    return NextResponse.json(
      { error: "Failed to fetch billing info" },
      { status: 500 },
    );
  }
}

// POST /api/v3/billing - Cancel subscription
export async function POST(request: Request) {
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
    const body = await request.json();
    const { action } = body;

    if (action === "cancel") {
      // Get user's subscription ID (or customer ID to look it up)
      const userResult = await pool.query(
        `SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1`,
        [session.userId],
      );

      let subscriptionId = userResult.rows[0]?.stripe_subscription_id;
      const customerId = userResult.rows[0]?.stripe_customer_id;

      // If no subscription ID but we have a customer ID, try to find the subscription
      if (!subscriptionId && customerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        if (subscriptions.data.length > 0) {
          subscriptionId = subscriptions.data[0].id;
          // Update the database with the found subscription ID
          await pool.query(
            `UPDATE users SET stripe_subscription_id = $1 WHERE id = $2`,
            [subscriptionId, session.userId],
          );
        }
      }

      if (!subscriptionId) {
        return NextResponse.json(
          { error: "No active subscription found" },
          { status: 400 },
        );
      }

      // Cancel at period end (user keeps access until billing period ends)
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });

      // Update user's subscription status in database
      await pool.query(
        `UPDATE users SET subscription_status = 'canceling' WHERE id = $1`,
        [session.userId],
      );

      return NextResponse.json({
        success: true,
        message:
          "Subscription will be canceled at the end of the billing period",
        cancelAt: subscription.cancel_at
          ? new Date(subscription.cancel_at * 1000).toISOString()
          : null,
        currentPeriodEnd: new Date(
          (subscription as unknown as { current_period_end: number })
            .current_period_end * 1000,
        ).toISOString(),
      });
    }

    if (action === "cancel_immediately") {
      // Get user's subscription ID (or customer ID to look it up)
      const userResult = await pool.query(
        `SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1`,
        [session.userId],
      );

      let subscriptionId = userResult.rows[0]?.stripe_subscription_id;
      const customerId = userResult.rows[0]?.stripe_customer_id;

      // If no subscription ID but we have a customer ID, try to find the subscription
      if (!subscriptionId && customerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: "active",
          limit: 1,
        });
        if (subscriptions.data.length > 0) {
          subscriptionId = subscriptions.data[0].id;
        }
      }

      if (!subscriptionId) {
        return NextResponse.json(
          { error: "No active subscription found" },
          { status: 400 },
        );
      }

      // Cancel immediately (user loses access now)
      await stripe.subscriptions.cancel(subscriptionId);

      // Update user's plan and subscription status in database. billing: a
      // staff account (lib/billing/staff-plan.ts) already holds a real,
      // granted pro_supporter floor -- canceling a real paid subscription
      // on top of that lands back on that floor, not all the way to free.
      await pool.query(
        `UPDATE users SET
          plan = ${staffPlanFloorCase("$2")},
          subscription_status = 'canceled',
          stripe_subscription_id = NULL,
          billing_interval = NULL
        WHERE id = $1`,
        [session.userId, STAFF_PLAN_FLOOR_ROLES],
      );

      return NextResponse.json({
        success: true,
        message: "Subscription canceled immediately",
      });
    }

    if (action === "reactivate") {
      // Get user's subscription ID
      const userResult = await pool.query(
        `SELECT stripe_subscription_id FROM users WHERE id = $1`,
        [session.userId],
      );

      const subscriptionId = userResult.rows[0]?.stripe_subscription_id;
      if (!subscriptionId) {
        return NextResponse.json(
          { error: "No subscription found" },
          { status: 400 },
        );
      }

      // Remove cancel at period end
      await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      // Update user's subscription status
      await pool.query(
        `UPDATE users SET subscription_status = 'active' WHERE id = $1`,
        [session.userId],
      );

      return NextResponse.json({
        success: true,
        message: "Subscription reactivated",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[Billing] Error processing billing action:", error);
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 },
    );
  }
}
