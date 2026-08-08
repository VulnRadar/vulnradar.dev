"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { getSession } from "@/lib/auth/auth";
import pool from "@/lib/database/db";

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

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
      const existing = await stripe.customers.retrieve(
        user.stripe_customer_id,
      );
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
      const price = await stripe.prices.create({
        currency: "usd",
        product_data: {
          name: product.name,
          metadata: { productId: product.id },
        },
        unit_amount: product.priceInCents,
        recurring: {
          interval: product.interval as "month" | "year",
        },
      });

      const updated = await stripe.subscriptions.update(
        existingSubscriptionId,
        {
          items: [
            { id: existingSubscription.items.data[0].id, price: price.id },
          ],
          proration_behavior: "create_prorations",
          metadata,
        },
      );

      return { kind: "switched", subscriptionId: updated.id };
    }
  }

  // Create a price first (prices.create supports product_data inline)
  const price = await stripe.prices.create({
    currency: "usd",
    product_data: {
      name: product.name,
      metadata: { productId: product.id },
    },
    unit_amount: product.priceInCents,
    recurring: {
      interval: product.interval as "month" | "year",
    },
  });

  // Create subscription with default_incomplete so client collects payment via Elements
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: price.id }],
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    expand: ["latest_invoice"],
    metadata,
  });

  // Stripe's Invoice object no longer exposes `payment_intent` directly (the
  // prior code force-cast around this with `as Invoice & { payment_intent }`,
  // which compiled but was always undefined at runtime). The client secret
  // now lives on `confirmation_secret`, populated on invoice finalization
  // with no separate expand needed.
  const invoice = subscription.latest_invoice as Stripe.Invoice | null;
  const clientSecret = invoice?.confirmation_secret?.client_secret;
  if (!clientSecret) {
    throw new Error("Failed to create payment intent for subscription");
  }

  return {
    kind: "new",
    clientSecret,
    subscriptionId: subscription.id,
  };
}

// Alias kept so any remaining import of startCheckoutSession doesn't hard-break
export const startCheckoutSession = createSubscription;
