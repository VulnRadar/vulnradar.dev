import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/database/db"
import { stripe } from "@/lib/billing/stripe"

// POST /api/v2/billing/verify - Verify code and return sensitive billing data
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { code } = await request.json()
    
    if (!code || typeof code !== "string" || code.length !== 6) {
      return NextResponse.json({ error: "Invalid verification code format" }, { status: 400 })
    }

    // Check code against database
    const codeResult = await pool.query(
      `SELECT id FROM billing_verification_codes 
       WHERE user_id = $1 
       AND code_hash = encode(sha256($2::bytea), 'hex')
       AND expires_at > NOW()`,
      [session.userId, code],
    )

    if (codeResult.rows.length === 0) {
      return NextResponse.json({ error: "Invalid or expired verification code" }, { status: 400 })
    }

    // Delete the used code
    await pool.query("DELETE FROM billing_verification_codes WHERE user_id = $1", [session.userId])

    // Get user's subscription info
    const userResult = await pool.query(
      `SELECT stripe_customer_id, stripe_subscription_id FROM users WHERE id = $1`,
      [session.userId]
    )
    const user = userResult.rows[0]

    if (!user?.stripe_subscription_id) {
      return NextResponse.json({ error: "No active subscription found" }, { status: 404 })
    }

    // Fetch detailed subscription info from Stripe
    const subscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id, {
      expand: ["default_payment_method", "latest_invoice", "customer"],
    })

    // Get customer details
    const customer = subscription.customer as { 
      email?: string
      name?: string
      address?: {
        line1?: string
        line2?: string
        city?: string
        state?: string
        postal_code?: string
        country?: string
      }
      phone?: string
    } | null

    // Get payment method details
    const paymentMethod = subscription.default_payment_method as {
      card?: {
        brand: string
        last4: string
        exp_month: number
        exp_year: number
        funding: string
        country?: string
      }
      billing_details?: {
        name?: string
        email?: string
        phone?: string
        address?: {
          line1?: string
          line2?: string
          city?: string
          state?: string
          postal_code?: string
          country?: string
        }
      }
    } | null

    // Get invoice details
    const latestInvoice = subscription.latest_invoice as {
      id?: string
      number?: string
      amount_paid?: number
      amount_due?: number
      status?: string
      created?: number
      hosted_invoice_url?: string
      invoice_pdf?: string
      subtotal?: number
      total?: number
      tax?: number
    } | null

    // Get subscription item for period data
    const item = subscription.items?.data?.[0]

    // Return sensitive billing details
    return NextResponse.json({
      success: true,
      sensitiveData: {
        // Subscription details
        subscriptionId: subscription.id,
        status: subscription.status,
        created: subscription.created ? new Date(subscription.created * 1000).toISOString() : null,
        startDate: subscription.start_date ? new Date(subscription.start_date * 1000).toISOString() : null,
        currentPeriodStart: item?.current_period_start ? new Date(item.current_period_start * 1000).toISOString() : null,
        currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
        cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
        canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
        endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
        trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        
        // Customer details
        customer: {
          email: customer?.email || null,
          name: customer?.name || null,
          phone: customer?.phone || null,
          address: customer?.address || null,
        },
        
        // Payment method
        paymentMethod: paymentMethod ? {
          cardBrand: paymentMethod.card?.brand || null,
          cardLast4: paymentMethod.card?.last4 || null,
          cardExpMonth: paymentMethod.card?.exp_month || null,
          cardExpYear: paymentMethod.card?.exp_year || null,
          cardFunding: paymentMethod.card?.funding || null,
          cardCountry: paymentMethod.card?.country || null,
          billingName: paymentMethod.billing_details?.name || null,
          billingEmail: paymentMethod.billing_details?.email || null,
          billingPhone: paymentMethod.billing_details?.phone || null,
          billingAddress: paymentMethod.billing_details?.address || null,
        } : null,
        
        // Latest invoice
        invoice: latestInvoice ? {
          id: latestInvoice.id || null,
          number: latestInvoice.number || null,
          amountPaid: latestInvoice.amount_paid ? latestInvoice.amount_paid / 100 : null,
          amountDue: latestInvoice.amount_due ? latestInvoice.amount_due / 100 : null,
          subtotal: latestInvoice.subtotal ? latestInvoice.subtotal / 100 : null,
          total: latestInvoice.total ? latestInvoice.total / 100 : null,
          tax: latestInvoice.tax ? latestInvoice.tax / 100 : null,
          status: latestInvoice.status || null,
          created: latestInvoice.created ? new Date(latestInvoice.created * 1000).toISOString() : null,
          hostedUrl: latestInvoice.hosted_invoice_url || null,
          pdfUrl: latestInvoice.invoice_pdf || null,
        } : null,
        
        // Stripe IDs (for support reference)
        stripeCustomerId: user.stripe_customer_id,
        stripeSubscriptionId: user.stripe_subscription_id,
      }
    })
  } catch (error) {
    console.error("[Billing] Error verifying code:", error)
    return NextResponse.json({ error: "Failed to verify code" }, { status: 500 })
  }
}
