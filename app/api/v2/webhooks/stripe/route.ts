import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { stripe, isStripeEnabled } from "@/lib/stripe"
import { updateUserSubscription, recordBillingHistory } from "@/lib/billing"
import pool from "@/lib/db"

export async function POST(request: NextRequest) {
  if (!isStripeEnabled() || !stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 })
  }

  const body = await request.text()
  const signature = request.headers.get("stripe-signature")

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error("[Stripe Webhook] Signature verification failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId ? parseInt(session.metadata.userId) : null
        const planId = session.metadata?.planId

        if (userId && planId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string)
          
          await updateUserSubscription(userId, {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            plan: planId,
            subscriptionStatus: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          })

          console.log(`[Stripe Webhook] User ${userId} subscribed to ${planId}`)
        }
        break
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find user by customer ID (now on users table)
        const userResult = await pool.query(
          `SELECT id FROM users WHERE stripe_customer_id = $1`,
          [customerId]
        )
        const userId = userResult.rows[0]?.id

        if (userId) {
          await updateUserSubscription(userId, {
            subscriptionStatus: subscription.status,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          })

          console.log(`[Stripe Webhook] Subscription updated for user ${userId}: ${subscription.status}`)
        }
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find user by customer ID (now on users table)
        const userResult = await pool.query(
          `SELECT id FROM users WHERE stripe_customer_id = $1`,
          [customerId]
        )
        const userId = userResult.rows[0]?.id

        if (userId) {
          await updateUserSubscription(userId, {
            plan: "free",
            subscriptionStatus: "canceled",
            stripeSubscriptionId: null,
          })

          console.log(`[Stripe Webhook] Subscription canceled for user ${userId}`)
        }
        break
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Find user by customer ID (now on users table)
        const userResult = await pool.query(
          `SELECT id FROM users WHERE stripe_customer_id = $1`,
          [customerId]
        )
        const userId = userResult.rows[0]?.id

        if (userId && invoice.id) {
          await recordBillingHistory(
            userId,
            invoice.id,
            invoice.amount_paid,
            "paid",
            invoice.lines.data[0]?.description || "Subscription payment",
            invoice.invoice_pdf || undefined
          )

          console.log(`[Stripe Webhook] Invoice paid for user ${userId}: $${(invoice.amount_paid / 100).toFixed(2)}`)
        }
        break
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // Find user by customer ID (now on users table)
        const userResult = await pool.query(
          `SELECT id FROM users WHERE stripe_customer_id = $1`,
          [customerId]
        )
        const userId = userResult.rows[0]?.id

        if (userId && invoice.id) {
          await recordBillingHistory(
            userId,
            invoice.id,
            invoice.amount_due,
            "failed",
            "Payment failed"
          )

          // Optionally downgrade to free on payment failure
          // await updateUserSubscription(userId, { plan: "free", subscriptionStatus: "past_due" })

          console.log(`[Stripe Webhook] Payment failed for user ${userId}`)
        }
        break
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[Stripe Webhook] Error processing event:", error)
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 })
  }
}
