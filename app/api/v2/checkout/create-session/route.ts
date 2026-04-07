import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/billing/stripe"
import { getSession } from "@/lib/auth"
import { PRODUCTS, getPlanFromProductId } from "@/lib/billing/products"
import pool from "@/lib/database/db"

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { productId } = body

    const product = PRODUCTS.find((p) => p.id === productId)
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 400 })
    }

    const planId = getPlanFromProductId(productId)

    // Get user's email for Stripe customer
    const userResult = await pool.query(
      `SELECT email, stripe_customer_id FROM users WHERE id = $1`,
      [session.userId]
    )
    const user = userResult.rows[0]
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          userId: String(session.userId),
        },
      })
      customerId = customer.id

      // Save customer ID to database
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customerId, session.userId]
      )
    }

    // Create a Subscription with payment collection
    // First create a price for the product
    const priceData = {
      currency: "usd",
      unit_amount: product.priceInCents,
      recurring: {
        interval: product.interval as "month" | "year",
      },
      product_data: {
        name: product.name,
        metadata: {
          productId: product.id,
        },
      },
    }

    // Create checkout session in subscription mode
    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: priceData,
          quantity: 1,
        },
      ],
      metadata: {
        planId,
        productId: product.id,
        userId: String(session.userId),
      },
      subscription_data: {
        metadata: {
          planId,
          productId: product.id,
          userId: String(session.userId),
          scansPerDay: product.scansPerDay.toString(),
        },
      },
      // Use embedded mode for custom UI
      ui_mode: "embedded",
      return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    })

    return NextResponse.json({
      clientSecret: checkoutSession.client_secret,
    })
  } catch (error) {
    console.error("[Checkout] Error creating session:", error)
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
