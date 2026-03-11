// ============================================================================
// Billing & Subscription Management
// ============================================================================
// Handles Stripe subscriptions, customer management, and billing history
// All subscription data is stored directly on the users table (clean schema)
// ============================================================================

import { stripe, isStripeEnabled } from "./stripe"
import pool from "./db"
import { getPlanById, getFreePlan } from "./plans"
import type { Plan } from "./plans"

export interface UserSubscription {
  userId: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  plan: string
  subscriptionStatus: string
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

/**
 * Get user's subscription data (from users table + gifted subscriptions)
 */
export async function getUserSubscription(userId: number): Promise<UserSubscription | null> {
  try {
    const [userResult, giftResult] = await Promise.all([
      pool.query(
        `SELECT id, plan, stripe_customer_id, stripe_subscription_id, 
                subscription_status, current_period_end, cancel_at_period_end
         FROM users WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT plan, expires_at FROM gifted_subscriptions 
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [userId]
      )
    ])
    
    if (!userResult.rows[0]) return null
    
    const row = userResult.rows[0]
    const giftedSub = giftResult.rows[0]
    
    return {
      userId: row.id,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      plan: giftedSub?.plan || row.plan || "free", // Gifted plan takes priority
      subscriptionStatus: giftedSub ? "gifted" : (row.subscription_status || "active"),
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end || false,
    }
  } catch (error) {
    console.error("[Billing] Error getting subscription:", error)
    return null
  }
}

/**
 * Get user's current plan (respects gifted subscriptions first)
 */
export async function getUserPlan(userId: number): Promise<Plan> {
  const subscription = await getUserSubscription(userId)
  if (!subscription) {
    return getFreePlan()
  }
  
  // Gifted plans should always return their plan, even if status doesn't indicate "active"
  if (subscription.subscriptionStatus === "gifted" || (subscription.plan && subscription.plan !== "free")) {
    return getPlanById(subscription.plan) || getFreePlan()
  }
  
  if (subscription.subscriptionStatus !== "active") {
    return getFreePlan()
  }
  
  return getPlanById(subscription.plan) || getFreePlan()
}

/**
 * Update user's subscription data (on users table)
 */
export async function updateUserSubscription(
  userId: number,
  data: Partial<{
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    plan: string
    subscriptionStatus: string
    currentPeriodEnd: Date | null
    cancelAtPeriodEnd: boolean
  }>
): Promise<void> {
  try {
    const setClauses: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (data.stripeCustomerId !== undefined) {
      setClauses.push(`stripe_customer_id = $${paramIndex++}`)
      values.push(data.stripeCustomerId)
    }
    if (data.stripeSubscriptionId !== undefined) {
      setClauses.push(`stripe_subscription_id = $${paramIndex++}`)
      values.push(data.stripeSubscriptionId)
    }
    if (data.plan !== undefined) {
      setClauses.push(`plan = $${paramIndex++}`)
      values.push(data.plan)
    }
    if (data.subscriptionStatus !== undefined) {
      setClauses.push(`subscription_status = $${paramIndex++}`)
      values.push(data.subscriptionStatus)
    }
    if (data.currentPeriodEnd !== undefined) {
      setClauses.push(`current_period_end = $${paramIndex++}`)
      values.push(data.currentPeriodEnd)
    }
    if (data.cancelAtPeriodEnd !== undefined) {
      setClauses.push(`cancel_at_period_end = $${paramIndex++}`)
      values.push(data.cancelAtPeriodEnd)
    }

    if (setClauses.length === 0) return

    setClauses.push(`updated_at = NOW()`)
    values.push(userId)

    await pool.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
      values
    )
  } catch (error) {
    console.error("[Billing] Error updating subscription:", error)
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

    await updateUserSubscription(userId, { stripeCustomerId: customer.id })
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
  const subscription = await getUserSubscription(userId)
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
      // IMPORTANT: Pass metadata to the subscription so webhooks can identify the plan
      subscription_data: {
        metadata: {
          userId: String(userId),
          productId: plan.id,
          planId: plan.id,
        },
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

    await updateUserSubscription(userId, { cancelAtPeriodEnd: true })
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

// Backwards compatibility - alias for upsertSubscription
export const upsertSubscription = async (userId: number, data: Partial<{
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  plan: string
  status: string
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}>) => {
  await updateUserSubscription(userId, {
    stripeCustomerId: data.stripeCustomerId,
    stripeSubscriptionId: data.stripeSubscriptionId,
    plan: data.plan,
    subscriptionStatus: data.status,
    currentPeriodEnd: data.currentPeriodEnd,
    cancelAtPeriodEnd: data.cancelAtPeriodEnd,
  })
}
