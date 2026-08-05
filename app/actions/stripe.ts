"use server";

import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import { getSession } from "@/lib/auth/auth";
import pool from "@/lib/database/db";

export async function createSubscription(productId: string): Promise<{
  clientSecret: string;
  subscriptionId: string;
}> {
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
    `SELECT email, name, stripe_customer_id FROM users WHERE id = $1`,
    [userId],
  );
  const user = userResult.rows[0];
  if (!user) throw new Error("User not found");

  let customerId: string = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name ?? undefined,
      metadata: { userId: String(userId) },
    });
    customerId = customer.id;
    await pool.query(`UPDATE users SET stripe_customer_id = $1 WHERE id = $2`, [
      customerId,
      userId,
    ]);
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
    expand: ["latest_invoice.payment_intent"],
    metadata: {
      planId,
      productId: product.id,
      userId: String(userId),
      scansPerDay: product.scansPerDay.toString(),
    },
  });

  const invoice = subscription.latest_invoice as Stripe.Invoice & {
    payment_intent: Stripe.PaymentIntent | null;
  };
  const paymentIntent = invoice?.payment_intent;

  const clientSecret = paymentIntent?.client_secret;
  if (!clientSecret) {
    throw new Error("Failed to create payment intent for subscription");
  }

  return {
    clientSecret,
    subscriptionId: subscription.id,
  };
}

// Alias kept so any remaining import of startCheckoutSession doesn't hard-break
export const startCheckoutSession = createSubscription;
