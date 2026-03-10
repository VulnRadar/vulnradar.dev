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
              subscription_status = $4
            WHERE email = $5`,
            [
              plan,
              customerId,
              subscriptionId,
              subscription.status,
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
        
        // Get productId from subscription metadata first (this is where it's stored!)
        let productId = subscription.metadata?.productId || ""
        let plan = getPlanFromProductId(productId)
        
        // Fallback: try to extract from price/product
        if (!plan || plan === "free") {
          productId = subscription.items?.data?.[0]?.price?.product as string || ""
          plan = getPlanFromProductId(productId)
        }

        // Try to update by stripe_customer_id first
        let result = await pool.query(
          `UPDATE users SET 
            plan = $1,
            stripe_subscription_id = $2,
            subscription_status = $3,
            stripe_customer_id = $4
          WHERE stripe_customer_id = $4
          RETURNING id`,
          [plan || "free", subscription.id, subscription.status, customerId]
        )
        
        // If no rows updated, try to find user by customer email from Stripe
        if (result.rowCount === 0) {
          const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
          if (customer.email) {
            result = await pool.query(
              `UPDATE users SET 
                plan = $1,
                stripe_subscription_id = $2,
                subscription_status = $3,
                stripe_customer_id = $4
              WHERE email = $5
              RETURNING id`,
              [plan || "free", subscription.id, subscription.status, customerId, customer.email]
            )
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[Stripe] Subscription created for ${customer.email}, plan: ${plan}`)
            } else {
              console.log(`[Stripe] Subscription created but no user found for email ${customer.email}`)
            }
          }
        } else {
          console.log(`[Stripe] Subscription created for customer ${customerId}, plan: ${plan}`)
        }
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        
        // Get productId from subscription metadata first
        let productId = subscription.metadata?.productId || ""
        let plan = getPlanFromProductId(productId)
        
        // Fallback: try to extract from price/product
        if (!plan || plan === "free") {
          productId = subscription.items?.data?.[0]?.price?.product as string || ""
          plan = getPlanFromProductId(productId)
        }

        await pool.query(
          `UPDATE users SET 
            plan = $1,
            subscription_status = $2
          WHERE stripe_customer_id = $3`,
          [plan || "free", subscription.status, customerId]
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

        if (customerId) {
          // Update subscription status to active (this is the important part)
          await pool.query(
            `UPDATE users SET subscription_status = 'active' WHERE stripe_customer_id = $1`,
            [customerId]
          )
          
          // Try to record in billing history (optional - don't fail if table doesn't exist)
          try {
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
          } catch (historyErr) {
            // billing_history table might not exist - log but don't fail
            console.log(`[Stripe] Could not record billing history (table may not exist):`, historyErr)
          }
          
          console.log(`[Stripe] Payment succeeded for customer ${customerId}`)
        }
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
