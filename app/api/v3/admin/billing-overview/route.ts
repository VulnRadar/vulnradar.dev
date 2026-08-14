import { NextResponse } from "next/server";
import pool from "@/lib/database/db";
import { requireAdmin } from "@/lib/auth/authorization";
import { getSetting } from "@/lib/config/runtime-config";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlanStatusCountRow {
  plan: string | null;
  subscription_status: string | null;
  count: number;
}

interface PastDueUserRow {
  id: number;
  email: string;
  name: string | null;
  plan: string | null;
  current_period_end: string | null;
}

interface StripeEventRow {
  event_id: string;
  event_type: string;
  processed_at: string;
}

interface PlanMixEntry {
  planId: PlanId;
  planName: string;
  priceInCents: number;
  totalUsers: number;
  activeUsers: number;
  mrrCents: number;
}

/**
 * GET /api/v3/admin/billing-overview
 *
 * Aggregate billing/subscription reporting for admins (AUDIT-010
 * admin-feature-gap: no MRR/plan-mix/failed-payment view without leaving
 * for the Stripe dashboard). Everything here is derived from data this
 * app already syncs into its own database via the Stripe webhook handler
 * (app/api/v3/webhooks/stripe/route.ts) -- users.plan/subscription_status/
 * stripe_customer_id and processed_stripe_events -- never a live Stripe
 * API call.
 *
 * "Active" (paying) reuses ACTIVE_SUBSCRIPTION_STATUSES
 * (lib/billing/subscription-status.ts), the same canonical "is this
 * subscription currently paying" definition the checkout action and the
 * webhook handler use. That reuse is what keeps a staff-granted comp plan
 * (lib/billing/staff-plan.ts writes users.plan directly on a role
 * promotion but never touches subscription_status) out of the MRR
 * estimate: a comped account's subscription_status stays NULL, not
 * "active"/"trialing"/"past_due", so it shows up in the plan-mix headcount
 * below but contributes nothing to activeUsers/mrrCents. A gifted
 * subscription (gifted_subscriptions table) is excluded from this report
 * entirely for the same reason -- it never touches users.plan either, so
 * a gifted user still reads as whatever paid/free plan their own account
 * is on.
 *
 * "Failed payments" has no dedicated local table -- the webhook's
 * invoice.payment_failed handler only flips users.subscription_status to
 * 'past_due' (see that handler's comment on why past_due keeps a grace
 * window instead of downgrading immediately); it never inserts a
 * billing_history row the way invoice.payment_succeeded does. So this
 * reports the two things that ARE tracked locally: which accounts are
 * currently sitting in that past_due grace window, and how many
 * invoice.payment_failed webhook deliveries processed_stripe_events has
 * recorded recently (event id/type/timestamp only -- that table has no
 * customer or amount column).
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  try {
    const [
      billingEnabled,
      planStatusResult,
      totalUsersResult,
      stripeCustomersResult,
      pastDueCountResult,
      pastDueListResult,
      failedEventsResult,
      failedEventsCountResult,
    ] = await Promise.all([
      getSetting("BILLING_ENABLED"),
      pool.query<PlanStatusCountRow>(
        `SELECT plan, subscription_status, COUNT(*)::int AS count
         FROM users
         GROUP BY plan, subscription_status`,
      ),
      pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM users`),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM users WHERE stripe_customer_id IS NOT NULL`,
      ),
      pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM users WHERE subscription_status = 'past_due'`,
      ),
      pool.query<PastDueUserRow>(
        `SELECT id, email, name, plan, current_period_end
         FROM users
         WHERE subscription_status = 'past_due'
         ORDER BY updated_at DESC
         LIMIT 20`,
      ),
      // processed_stripe_events is created defensively elsewhere (see its
      // own CREATE TABLE comment in instrumentation.ts) -- fall back to an
      // empty list rather than failing the whole report if it's somehow
      // missing on an old/self-hosted deployment.
      pool
        .query<StripeEventRow>(
          `SELECT event_id, event_type, processed_at
           FROM processed_stripe_events
           WHERE event_type = 'invoice.payment_failed'
           ORDER BY processed_at DESC
           LIMIT 20`,
        )
        .catch(() => ({ rows: [] as StripeEventRow[] })),
      pool
        .query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM processed_stripe_events
           WHERE event_type = 'invoice.payment_failed'
             AND processed_at > NOW() - INTERVAL '30 days'`,
        )
        .catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const planMix: PlanMixEntry[] = PLANS.map((plan) => {
      let totalUsers = 0;
      let activeUsers = 0;
      for (const row of planStatusResult.rows) {
        if ((row.plan || "free") !== plan.id) continue;
        const count = Number(row.count) || 0;
        totalUsers += count;
        if (
          row.subscription_status &&
          ACTIVE_SUBSCRIPTION_STATUSES.includes(row.subscription_status)
        ) {
          activeUsers += count;
        }
      }
      return {
        planId: plan.id,
        planName: plan.name,
        priceInCents: plan.priceInCents,
        totalUsers,
        activeUsers,
        mrrCents: plan.priceInCents * activeUsers,
      };
    });

    const payingUsers = planMix.reduce((sum, p) => sum + p.activeUsers, 0);
    const mrrCents = planMix.reduce((sum, p) => sum + p.mrrCents, 0);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      billingEnabled: !!billingEnabled,
      totals: {
        totalUsers: Number(totalUsersResult.rows[0]?.count) || 0,
        payingUsers,
        mrrCents,
        stripeCustomers: Number(stripeCustomersResult.rows[0]?.count) || 0,
        pastDueUsers: Number(pastDueCountResult.rows[0]?.count) || 0,
      },
      planMix,
      failedPayments: {
        pastDueUsers: pastDueListResult.rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          plan: row.plan || "free",
          currentPeriodEnd: row.current_period_end,
        })),
        recentEvents: failedEventsResult.rows.map((row) => ({
          eventId: row.event_id,
          eventType: row.event_type,
          processedAt: row.processed_at,
        })),
        recentEventCount30d:
          Number(failedEventsCountResult.rows[0]?.count) || 0,
      },
    });
  } catch (error) {
    console.error(
      "[admin/billing-overview] Failed to build billing overview:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to build billing overview." },
      { status: 500 },
    );
  }
}
