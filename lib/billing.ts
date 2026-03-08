// ============================================================================
// Billing & Subscription Management
// ============================================================================
// Handles Stripe subscriptions, customer management, and billing history
// ============================================================================

import { stripe, isStripeEnabled } from "./stripe"
import pool from "./db"
import { PLANS, getPlanById, getFreePlan } from "./plans"
import type { Plan } from "./plans"

export interface Subscription {
  id: number
  userId: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  plan: string
  status: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * Get user's subscription
 */
export async function getUserSubscription(userId: number): Promise<Subscription | null> {
  try {
    const result = await pool.query(
      `SELECT * FROM subscriptions WHERE user_id = $1`,
      [userId]
    )
    if (!result.rows[0]) return null
    
    const row = result.rows[0]
    return {
      id: row.id,
      userId: row.user_id,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      plan: row.plan,
      status: row.status,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  } catch (error) {
    console.error("[Billing] Error getting subscription:", error)
    return null
  }
}

/**
 * Get user's current plan
 */
export async function getUserPlan(userId: number): Promise<Plan> {
  const subscription = await getUserSubscription(userId)
  if (!subscription || subscription.status !== "active") {
    return getFreePlan()
  }
  return getPlanById(subscription.plan) || getFreePlan()
}

/**
 * Create or update subscription record
 */
export async function upsertSubscription(
  userId: number,
  data: Partial<Subscription>
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) 
       DO UPDATE SET 
         stripe_customer_id = COALESCE($2, subscriptions.stripe_customer_id),
         stripe_subscription_id = COALESCE($3, subscriptions.stripe_subscription_id),
         plan = COALESCE($4, subscriptions.plan),
         status = COALESCE($5, subscriptions.status),
         current_period_start = COALESCE($6, subscriptions.current_period_start),
         current_period_end = COALESCE($7, subscriptions.current_period_end),
         cancel_at_period_end = COALESCE($8, subscriptions.cancel_at_period_end),
         updated_at = NOW()`,
      [
        userId,
        data.stripeCustomerId || null,
        data.stripeSubscriptionId || null,
        data.plan || "free",
        data.status || "active",
        data.currentPeriodStart || null,
        data.currentPeriodEnd || null,
        data.cancelAtPeriodEnd || false,
      ]
    )
  } catch (error) {
    console.error("[Billing] Error upserting subscription:", error)
    throw error
  }
}

/**
 * Create a Stripe customer for a user
 */
export async function createStripeCustomer(userId: number, email: string, name?: string): Promise<string | null> {
  if (!isStripeEnabled() || !stripe) {
    console.warn("[Billing] Stripe not enabled, skipping customer creation")
    return null
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name: name || undefined,
      metadata: {
        userId: String(userId),
      },
    })

    await upsertSubscription(userId, { stripeCustomerId: customer.id })
    return customer.id
  } catch (error) {
    console.error("[Billing] Error creating Stripe customer:", error)
    return null
  }
}

/**
 * Create a checkout session for subscription
 */
export async function createSubscriptionCheckout(
  userId: number,
  planId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<string | null> {
  if (!isStripeEnabled() || !stripe) {
    throw new Error("Stripe is not configured")
  }

  const plan = getPlanById(planId)
  if (!plan || plan.priceInCents === 0) {
    throw new Error("Invalid plan")
  }

  // Get or create Stripe customer
  let subscription = await getUserSubscription(userId)
  let customerId = subscription?.stripeCustomerId

  if (!customerId) {
    customerId = await createStripeCustomer(userId, email)
  }

  try {
    const session = await stripe.checkout.sessions.create({
      customer: customerId || undefined,
      customer_email: customerId ? undefined : email,
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: plan.name,
              description: plan.description,
            },
            unit_amount: plan.priceInCents,
            recurring: {
              interval: "month",
            },
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: String(userId),
        planId: plan.id,
      },
    })

    return session.url
  } catch (error) {
    console.error("[Billing] Error creating checkout session:", error)
    throw error
  }
}

/**
 * Create a portal session for managing subscription
 */
export async function createBillingPortalSession(
  userId: number,
  returnUrl: string
): Promise<string | null> {
  if (!isStripeEnabled() || !stripe) {
    throw new Error("Stripe is not configured")
  }

  const subscription = await getUserSubscription(userId)
  if (!subscription?.stripeCustomerId) {
    throw new Error("No billing account found")
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
    })

    return session.url
  } catch (error) {
    console.error("[Billing] Error creating portal session:", error)
    throw error
  }
}

/**
 * Cancel subscription at period end
 */
export async function cancelSubscription(userId: number): Promise<void> {
  if (!isStripeEnabled() || !stripe) {
    throw new Error("Stripe is not configured")
  }

  const subscription = await getUserSubscription(userId)
  if (!subscription?.stripeSubscriptionId) {
    throw new Error("No active subscription found")
  }

  try {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    })

    await upsertSubscription(userId, { cancelAtPeriodEnd: true })
  } catch (error) {
    console.error("[Billing] Error canceling subscription:", error)
    throw error
  }
}

/**
 * Record billing history entry
 */
export async function recordBillingHistory(
  userId: number,
  stripeInvoiceId: string,
  amountCents: number,
  status: string,
  description?: string,
  invoicePdfUrl?: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO billing_history (user_id, stripe_invoice_id, amount_cents, status, description, invoice_pdf_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (stripe_invoice_id) DO NOTHING`,
      [userId, stripeInvoiceId, amountCents, status, description, invoicePdfUrl]
    )
  } catch (error) {
    console.error("[Billing] Error recording billing history:", error)
  }
}

/**
 * Get billing history for a user
 */
export async function getBillingHistory(userId: number): Promise<{
  id: number
  amountCents: number
  currency: string
  status: string
  description: string | null
  invoicePdfUrl: string | null
  createdAt: Date
}[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM billing_history WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId]
    )
    return result.rows.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      description: row.description,
      invoicePdfUrl: row.invoice_pdf_url,
      createdAt: row.created_at,
    }))
  } catch (error) {
    console.error("[Billing] Error getting billing history:", error)
    return []
  }
}
