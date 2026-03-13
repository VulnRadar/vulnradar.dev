import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { getPlanFromProductId } from "@/lib/products"
import pool from "@/lib/db"
import Stripe from "stripe"

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

// Helper function to grant premium badge to user
async function grantPremiumBadge(userId: number) {
  try {
    // Get the premium badge ID
    const badgeResult = await pool.query(
      `SELECT id FROM badges WHERE name = 'premium' LIMIT 1`
    )
    if (badgeResult.rows.length === 0) {
      console.log(`[Stripe] Premium badge not found in database`)
      return
    }
    const badgeId = badgeResult.rows[0].id

    // Grant badge if not already granted
    await pool.query(
      `INSERT INTO user_badges (user_id, badge_id) 
       VALUES ($1, $2) 
       ON CONFLICT (user_id, badge_id) DO NOTHING`,
      [userId, badgeId]
    )
    console.log(`[Stripe] Granted premium badge to user ${userId}`)
  } catch (err) {
    console.error(`[Stripe] Failed to grant premium badge:`, err)
  }
}

// Helper function to revoke premium badge from user
async function revokePremiumBadge(userId: number) {
  try {
    // Get the premium badge ID
    const badgeResult = await pool.query(
      `SELECT id FROM badges WHERE name = 'premium' LIMIT 1`
    )
    if (badgeResult.rows.length === 0) return
    const badgeId = badgeResult.rows[0].id

    // Remove badge
    await pool.query(
      `DELETE FROM user_badges WHERE user_id = $1 AND badge_id = $2`,
      [userId, badgeId]
    )
    console.log(`[Stripe] Revoked premium badge from user ${userId}`)
  } catch (err) {
    console.error(`[Stripe] Failed to revoke premium badge:`, err)
  }
}

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
        
        // Get userId and planId directly from session metadata (set in startCheckoutSession)
        const userId = session.metadata?.userId ? parseInt(session.metadata.userId, 10) : null
        let plan = session.metadata?.planId || ""
        
        // Validate the plan is a valid supporter plan
        if (!plan || !["core_supporter", "pro_supporter", "elite_supporter"].includes(plan)) {
          // Try to get from subscription metadata
          if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId)
            plan = subscription.metadata?.planId || subscription.metadata?.productId || ""
            
            // Last resort: check product name
            if (!plan && subscription.items?.data?.[0]) {
              const productName = subscription.items.data[0].price?.nickname || ""
              if (productName.toLowerCase().includes("elite")) plan = "elite_supporter"
              else if (productName.toLowerCase().includes("pro")) plan = "pro_supporter"
              else if (productName.toLowerCase().includes("core")) plan = "core_supporter"
            }
          }
        }

        if (subscriptionId) {
          let result
          
          // Primary: Update by userId if available (most reliable - ID never changes)
          if (userId) {
            result = await pool.query(
              `UPDATE users SET 
                plan = $1,
                stripe_customer_id = $2,
                stripe_subscription_id = $3,
                subscription_status = 'active'
              WHERE id = $4
              RETURNING id, email`,
              [plan || "free", customerId, subscriptionId, userId]
            )
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[Stripe] User ID ${userId} upgraded to ${plan}`)
              // Grant premium badge
              await grantPremiumBadge(userId)
            }
          }
          
          // Fallback: Update by email if userId lookup failed
          if ((!result || result.rowCount === 0) && customerEmail) {
            result = await pool.query(
              `UPDATE users SET 
                plan = $1,
                stripe_customer_id = $2,
                stripe_subscription_id = $3,
                subscription_status = 'active'
              WHERE LOWER(email) = LOWER($4)
              RETURNING id, email`,
              [plan || "free", customerId, subscriptionId, customerEmail]
            )
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[Stripe] User ${customerEmail} upgraded to ${plan}`)
              // Grant premium badge
              await grantPremiumBadge(result.rows[0].id)
            } else {
              console.log(`[Stripe] checkout.session.completed but no user found for email ${customerEmail}`)
            }
          }
        }
        break
      }

      case "customer.subscription.created": {
        // New subscription created - update user's plan
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string
        
        // Get userId and planId from subscription metadata (set in startCheckoutSession)
        const userId = subscription.metadata?.userId ? parseInt(subscription.metadata.userId, 10) : null
        let plan = subscription.metadata?.planId || ""
        
        // Fallback: try to get plan from productId
        if (!plan || !["core_supporter", "pro_supporter", "elite_supporter"].includes(plan)) {
          const productId = subscription.metadata?.productId || ""
          plan = getPlanFromProductId(productId)
        }
        
        // Fallback: try to extract from price/product
        if (!plan || plan === "free") {
          const productId = subscription.items?.data?.[0]?.price?.product as string || ""
          plan = getPlanFromProductId(productId)
        }

        let result
        
        // Primary: Update by userId if available (most reliable)
        if (userId) {
          result = await pool.query(
            `UPDATE users SET 
              plan = $1,
              stripe_subscription_id = $2,
              subscription_status = $3,
              stripe_customer_id = $4
            WHERE id = $5
            RETURNING id`,
            [plan || "free", subscription.id, subscription.status, customerId, userId]
          )
          if (result.rowCount && result.rowCount > 0) {
            console.log(`[Stripe] Subscription created for user ID ${userId}, plan: ${plan}`)
            // Grant premium badge for paid plans
            if (plan && plan !== "free") {
              await grantPremiumBadge(userId)
            }
          }
        }
        
        // Fallback: Try stripe_customer_id
        if (!result || result.rowCount === 0) {
          result = await pool.query(
            `UPDATE users SET 
              plan = $1,
              stripe_subscription_id = $2,
              subscription_status = $3
            WHERE stripe_customer_id = $4
            RETURNING id`,
            [plan || "free", subscription.id, subscription.status, customerId]
          )
          if (result.rowCount && result.rowCount > 0) {
            console.log(`[Stripe] Subscription created for customer ${customerId}, plan: ${plan}`)
            // Grant premium badge for paid plans
            if (plan && plan !== "free") {
              await grantPremiumBadge(result.rows[0].id)
            }
          }
        }
        
        // Last fallback: Try email from Stripe customer
        if (!result || result.rowCount === 0) {
          const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer
          if (customer.email) {
            result = await pool.query(
              `UPDATE users SET 
                plan = $1,
                stripe_subscription_id = $2,
                subscription_status = $3,
                stripe_customer_id = $4
              WHERE LOWER(email) = LOWER($5)
              RETURNING id`,
              [plan || "free", subscription.id, subscription.status, customerId, customer.email]
            )
            if (result.rowCount && result.rowCount > 0) {
              console.log(`[Stripe] Subscription created for ${customer.email}, plan: ${plan}`)
              // Grant premium badge for paid plans
              if (plan && plan !== "free") {
                await grantPremiumBadge(result.rows[0].id)
              }
            } else {
              console.log(`[Stripe] Subscription created but no user found for email ${customer.email}`)
            }
          }
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

        // Downgrade to free plan and revoke premium badge
        const result = await pool.query(
          `UPDATE users SET 
            plan = 'free',
            subscription_status = 'canceled',
            stripe_subscription_id = NULL
          WHERE stripe_customer_id = $1
          RETURNING id`,
          [customerId]
        )
        if (result.rowCount && result.rowCount > 0) {
          await revokePremiumBadge(result.rows[0].id)
        }
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
