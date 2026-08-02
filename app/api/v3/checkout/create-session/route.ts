import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe"; // used for PaymentIntent cast
import { getStripe } from "@/lib/billing/stripe";
import { getSession } from "@/lib/auth";
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products";
import pool from "@/lib/database/db";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 },
    );
  }

  try {
    const session = await getSession();
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { productId } = body;

    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 400 });
    }

    const planId = getPlanFromProductId(productId);

    const userResult = await pool.query(
      `SELECT email, name, stripe_customer_id FROM users WHERE id = $1`,
      [session.userId],
    );
    const user = userResult.rows[0];
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get or create Stripe customer
    let customerId: string = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name ?? undefined,
        metadata: { userId: String(session.userId) },
      });
      customerId = customer.id;
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, session.userId],
      );
    }

    // Create subscription with default_incomplete — client collects payment via Elements.
    // price_data cast avoids SDK version differences in the PriceData type definition.
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          price_data: {
            currency: "usd",
            product_data: {
              name: product.name,
              metadata: { productId: product.id },
            },
            unit_amount: product.priceInCents,
            recurring: {
              interval: product.interval as "month" | "year",
            },
          } as any,
        },
      ],
      payment_behavior: "default_incomplete",
      payment_settings: {
        save_default_payment_method: "on_subscription",
      },
      expand: ["latest_invoice.payment_intent"],
      metadata: {
        planId,
        productId: product.id,
        userId: String(session.userId),
        scansPerDay: product.scansPerDay.toString(),
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invoice = subscription.latest_invoice as any;
    const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;
    const clientSecret = paymentIntent?.client_secret;

    if (!clientSecret) {
      return NextResponse.json(
        { error: "Failed to create payment intent" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscription.id,
    });
  } catch (error) {
    console.error("[Checkout] Error creating subscription:", error);
    return NextResponse.json(
      { error: "Failed to create subscription" },
      { status: 500 },
    );
  }
}
