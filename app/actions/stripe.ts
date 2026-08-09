"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { getOrCreateStripePriceId } from "@/lib/billing/stripe-catalog";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/lib/billing/subscription-status";
import { grantPremiumBadge, revokePremiumBadge } from "@/lib/billing/badges";
import { getSession } from "@/lib/auth/auth";
import pool from "@/lib/database/db";

export type CreateSubscriptionResult =
  | { kind: "new"; clientSecret: string; subscriptionId: string }
  | { kind: "switched"; subscriptionId: string };

export async function createSubscription(
  productId: string,
): Promise<CreateSubscriptionResult> {
  // auth: userId is derived from the session — client-supplied userId
  // is never trusted (any session could otherwise upgrade a victim).
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to subscribe");
  }
  const userId = sessionUser.userId;

  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product with id "${productId}" not found`);
  }

  const planId = getPlanFromProductId(productId);

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  // Get or create Stripe customer
  const userResult = await pool.query(
    `SELECT email, name, stripe_customer_id, stripe_subscription_id, subscription_status
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("User not found");

  async function createStripeCustomer(): Promise<string> {
    const customer = await stripe!.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(userId) },
    });
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [
      customer.id,
      userId,
    ]);
    return customer.id;
  }

  // A stored stripe_customer_id can go stale: the Stripe account was reset,
  // the API key moved from live to test mode (or vice versa), or the
  // customer was deleted directly in the dashboard. Any of those leaves a
  // row pointing at a customer id Stripe no longer recognizes, and every
  // downstream call (subscriptions.create, subscriptions.retrieve) fails
  // with a generic "No such customer" 404 that has nothing to do with this
  // checkout attempt itself. Verify it actually resolves before trusting
  // it, and silently re-create rather than surfacing that as a checkout
  // failure -- the customer is a Stripe-side implementation detail, not
  // something the subscriber should ever have to know went missing.
  let customerId: string;
  if (!user.stripe_customer_id) {
    customerId = await createStripeCustomer();
  } else {
    try {
      const existing = await stripe.customers.retrieve(user.stripe_customer_id);
      if (existing.deleted) throw new Error("customer deleted");
      customerId = user.stripe_customer_id;
    } catch {
      customerId = await createStripeCustomer();
    }
  }

  const metadata = {
    planId,
    productId: product.id,
    userId: String(userId),
    scansPerDay: product.scansPerDay.toString(),
  };

  // billing: a user who already has an active paid subscription and picks a
  // different plan (upgrade or downgrade) must have their EXISTING Stripe
  // subscription switched to the new price, not a second one created
  // alongside it. Without this check, every plan change created a parallel
  // subscription and the customer was billed for both.
  const existingSubscriptionId = user.stripe_subscription_id as string | null;
  if (
    existingSubscriptionId &&
    ACTIVE_SUBSCRIPTION_STATUSES.includes(user.subscription_status)
  ) {
    const existingSubscription = await stripe.subscriptions
      .retrieve(existingSubscriptionId)
      .catch(() => null);
    if (
      existingSubscription &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(existingSubscription.status)
    ) {
      const priceId = await getOrCreateStripePriceId(stripe, product);

      const updated = await stripe.subscriptions.update(
        existingSubscriptionId,
        {
          items: [
            { id: existingSubscription.items.data[0].id, price: priceId },
          ],
          proration_behavior: "create_prorations",
          metadata,
        },
      );

      return { kind: "switched", subscriptionId: updated.id };
    }
  }

  const priceId = await getOrCreateStripePriceId(stripe, product);

  // Create subscription with default_incomplete so client collects payment via Elements
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    // `expand: ["latest_invoice"]` alone turns latest_invoice into a full
    // Invoice object, but confirmation_secret is itself only populated when
    // separately expanded (Stripe's own default_incomplete guide expands
    // "latest_invoice.confirmation_secret" explicitly) -- without the
    // nested path it comes back undefined even though Stripe finalized the
    // invoice and created the PaymentIntent server-side, which is exactly
    // what threw "Failed to create payment intent" here despite the
    // subscription (and its webhook events) existing correctly in Stripe.
    expand: ["latest_invoice.confirmation_secret"],
    metadata,
  });

  // Stripe's Invoice object no longer exposes `payment_intent` directly (the
  // prior code force-cast around this with `as Invoice & { payment_intent }`,
  // which compiled but was always undefined at runtime). The client secret
  // now lives on `confirmation_secret`, populated on invoice finalization,
  // but only comes back on the response when explicitly expanded (see
  // above).
  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const clientSecret = invoice?.confirmation_secret?.client_secret;
  if (!clientSecret) {
    // No confirmation_secret doesn't necessarily mean creation failed: a
    // customer with a working default payment method on file (from an
    // earlier subscription, e.g.) can have this first invoice settle
    // synchronously with nothing left to confirm client-side, which
    // Stripe represents as the subscription already being active/trialing
    // with no payment intent to hand back. That's success, not an error --
    // report it the same way an in-place plan switch already is (no
    // Elements form needed, just verify the plan changed).
    if (ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status)) {
      return { kind: "switched", subscriptionId: subscription.id };
    }
    throw new Error("Failed to create payment intent for subscription");
  }

  return {
    kind: "new",
    clientSecret,
    subscriptionId: subscription.id,
  };
}

export interface ConfirmSubscriptionResult {
  plan: string;
  active: boolean;
}

/**
 * Writes a subscription's current Stripe status straight to the users row,
 * called right after the client confirms payment (or right after an
 * in-place plan switch) instead of waiting on the Stripe webhook. A
 * self-hosted deployment with no public URL for Stripe to call back to (no
 * `stripe listen` forwarding, no tunnel) would otherwise never receive
 * customer.subscription.updated at all -- the payment goes through on
 * Stripe's side but the account stays on "free" forever. The webhook stays
 * the source of truth for everything that happens *after* this moment
 * (renewals, cancellations, past_due), this only covers the one instant
 * the user is actually sitting on the checkout page waiting for an answer.
 */
export async function confirmSubscription(
  subscriptionId: string,
): Promise<ConfirmSubscriptionResult> {
  const sessionUser = await getSession();
  if (!sessionUser) {
    throw new Error("User must be logged in to confirm a subscription");
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Authorization: createSubscription() always stamps the creating user's
  // id into metadata. Without this check, anyone logged in could pass an
  // arbitrary subscription id belonging to a stranger and have their own
  // account upgraded off someone else's payment.
  if (subscription.metadata?.userId !== String(sessionUser.userId)) {
    throw new Error("This subscription does not belong to your account");
  }

  const isPaid = ACTIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
  const resolvedPlan = getPlanFromProductId(
    subscription.metadata?.productId || "",
  );
  const planToWrite = isPaid && resolvedPlan !== "free" ? resolvedPlan : "free";

  await pool.query(
    `UPDATE users SET
      plan = $1,
      stripe_subscription_id = $2,
      subscription_status = $3,
      stripe_customer_id = $4
    WHERE id = $5`,
    [
      planToWrite,
      subscription.id,
      subscription.status,
      subscription.customer as string,
      sessionUser.userId,
    ],
  );

  if (planToWrite !== "free") {
    await grantPremiumBadge(sessionUser.userId);
  } else {
    await revokePremiumBadge(sessionUser.userId);
  }

  return { plan: planToWrite, active: isPaid };
}

// Alias kept so any remaining import of startCheckoutSession doesn't hard-break
export const startCheckoutSession = createSubscription;
