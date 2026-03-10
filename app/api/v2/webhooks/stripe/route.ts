import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { getPlanFromProductId } from "@/lib/products"
import pool from "@/lib/db"
import Stripe from "stripe"

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get("stripe-signature")!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error("Webhook signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const customerEmail = session.customer_email
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string

        if (customerEmail && subscriptionId) {
          // Get subscription details - metadata.productId is set in startCheckoutSession
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)
          
          // The productId is stored in subscription metadata (from subscription_data.metadata in checkout)
          const productId = subscription.metadata?.productId || ""
          let plan = getPlanFromProductId(productId)
          
          // Fallback: if no productId in metadata, try to get from product name
          if (plan === "free" && subscription.items?.data?.[0]) {
            const priceId = subscription.items.data[0].price?.id || ""
            const productIdFromPrice = subscription.items.data[0].price?.product as string || ""
            plan = getPlanFromProductId(productIdFromPrice) || getPlanFromProductId(priceId) || "free"
            
            // Also check product name as last resort
            if (plan === "free") {
              const productName = subscription.items.data[0].price?.nickname || 
                                 (typeof subscription.items.data[0].price?.product === 'object' 
                                   ? (subscription.items.data[0].price.product as Stripe.Product).name 
                                   : "")
              if (productName.toLowerCase().includes("elite")) plan = "elite_supporter"
              else if (productName.toLowerCase().includes("pro")) plan = "pro_supporter"
              else if (productName.toLowerCase().includes("core")) plan = "core_supporter"
            }
          }

          // Update user in database
          await pool.query(
            `UPDATE users SET 
              plan = $1,
              stripe_customer_id = $2,
              stripe_subscription_id = $3,
              subscription_status = $4,
              subscription_current_period_end = to_timestamp($5)
            WHERE email = $6`,
            [
              plan,
              customerId,
              subscriptionId,
              subscription.status,
              subscription.current_period_end,
              customerEmail,
            ]
          )
          console.log(`[Stripe] User ${customerEmail} upgraded to ${plan}`)
        }
        break
      }

      case "customer.subscription.created": {
        // New subscription created - update user's plan
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        const priceId = subscription.items?.data?.[0]?.price?.id || ""
        const productId = subscription.items?.data?.[0]?.price?.product as string || ""
        const plan = getPlanFromProductId(productId) || getPlanFromProductId(priceId)

        await pool.query(
          `UPDATE users SET 
            plan = $1,
            stripe_subscription_id = $2,
            subscription_status = $3,
            subscription_current_period_end = to_timestamp($4)
          WHERE stripe_customer_id = $5`,
          [plan, subscription.id, subscription.status, subscription.current_period_end, customerId]
        )
        console.log(`[Stripe] Subscription created for customer ${customerId}, plan: ${plan}`)
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        const priceId = subscription.items?.data?.[0]?.price?.id || ""
        const productId = subscription.items?.data?.[0]?.price?.product as string || ""
        const plan = getPlanFromProductId(productId) || getPlanFromProductId(priceId)

        await pool.query(
          `UPDATE users SET 
            plan = $1,
            subscription_status = $2,
            subscription_current_period_end = to_timestamp($3)
          WHERE stripe_customer_id = $4`,
          [plan, subscription.status, subscription.current_period_end, customerId]
        )
        console.log(`[Stripe] Subscription updated for customer ${customerId}, plan: ${plan}`)
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Downgrade to free plan
        await pool.query(
          `UPDATE users SET 
            plan = 'free',
            subscription_status = 'canceled',
            stripe_subscription_id = NULL
          WHERE stripe_customer_id = $1`,
          [customerId]
        )
        console.log(`[Stripe] Subscription canceled for customer ${customerId}`)
        break
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Record in billing history
        await pool.query(
          `INSERT INTO billing_history 
            (user_id, stripe_invoice_id, stripe_payment_intent_id, amount_cents, currency, status, description, invoice_pdf_url)
          SELECT id, $1, $2, $3, $4, $5, $6, $7
          FROM users WHERE stripe_customer_id = $8`,
          [
            invoice.id,
            invoice.payment_intent,
            invoice.amount_paid,
            invoice.currency,
            "succeeded",
            invoice.description || `Payment for ${invoice.lines?.data?.[0]?.description || "subscription"}`,
            invoice.invoice_pdf,
            customerId,
          ]
        )
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        await pool.query(
          `UPDATE users SET subscription_status = 'past_due' WHERE stripe_customer_id = $1`,
          [customerId]
        )
        console.log(`[Stripe] Payment failed for customer ${customerId}`)
        break
      }
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error("Webhook handler error:", err)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
