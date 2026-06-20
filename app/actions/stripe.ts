"use server";

import { getStripe } from "@/lib/billing/stripe";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";

export async function startCheckoutSession(productId: string, userId?: number) {
  const product = PRODUCTS.find((p) => p.id === productId);
  if (!product) {
    throw new Error(`Product with id "${productId}" not found`);
  }

  if (!userId) {
    throw new Error("User must be logged in to subscribe");
  }

  // Get the plan ID (e.g., "pro_supporter" from "pro_supporter_monthly")
  const planId = getPlanFromProductId(productId);

  // R1: Stripe lazy accessor — bail out gracefully when not configured.
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Stripe is not configured on this server.");
  }

  // Create Checkout Session for subscription
  // Email is entered by user in Stripe checkout - we only track by userId
  const session = await stripe.checkout.sessions.create({
    ui_mode: "embedded_page",
    redirect_on_completion: "never",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: product.name,
            description: product.description,
          },
          unit_amount: product.priceInCents,
          recurring: {
            interval: product.interval,
          },
        },
        quantity: 1,
      },
    ],
    mode: "subscription",
    // Store planId and userId in session metadata for checkout.session.completed webhook
    metadata: {
      planId: planId,
      productId: product.id,
      userId: String(userId),
    },
    // Also store on subscription for subscription.* webhooks
    subscription_data: {
      metadata: {
        planId: planId,
        productId: product.id,
        userId: String(userId),
        scansPerDay: product.scansPerDay.toString(),
      },
    },
    // Custom appearance for dark theme matching our site
    custom_text: {
      submit: {
        message:
          "Your subscription will renew automatically each billing period.",
      },
    },
  });

  return session.client_secret;
}
