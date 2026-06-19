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
      created?: number
      balance?: number
      delinquent?: boolean
      tax_exempt?: string
    } | null

    // Get payment method details
    const paymentMethod = subscription.default_payment_method as {
      id?: string
      card?: {
        brand: string
        last4: string
        exp_month: number
        exp_year: number
        funding: string
        country?: string
        fingerprint?: string
        checks?: {
          cvc_check?: string
          postal_code_check?: string
          address_line1_check?: string
        }
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
      created?: number
      three_d_secure_usage?: {
        supported?: boolean
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
      billing_reason?: string
      status_transitions?: {
        paid_at?: number
      }
      attempt_count?: number
      period_start?: number
      period_end?: number
      due_date?: number
      collection_method?: string
      lines?: {
        data: Array<{
          description?: string
          amount?: number
          quantity?: number
        }>
      }
    } | null

    // Get subscription item for period data and plan info
    const item = subscription.items?.data?.[0]
    const plan = item?.plan as {
      id?: string
      amount?: number
      interval?: string
      interval_count?: number
      product?: {
        id?: string
        name?: string
      }
    } | null

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
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
        billingCycleAnchor: subscription.billing_cycle_anchor || null,
        currency: subscription.currency || null,
        
        // Customer details
        customer: {
          email: customer?.email || null,
          name: customer?.name || null,
          phone: customer?.phone || null,
          balance: customer?.balance ? customer.balance / 100 : null,
          delinquent: customer?.delinquent || false,
          taxExempt: customer?.tax_exempt || null,
          address: customer?.address || null,
        },
        
        // Payment method
        paymentMethod: paymentMethod ? {
          id: paymentMethod.id || null,
          cardBrand: paymentMethod.card?.brand || null,
          cardLast4: paymentMethod.card?.last4 || null,
          cardExpMonth: paymentMethod.card?.exp_month || null,
          cardExpYear: paymentMethod.card?.exp_year || null,
          cardFunding: paymentMethod.card?.funding || null,
          cardCountry: paymentMethod.card?.country || null,
          cardFingerprint: paymentMethod.card?.fingerprint || null,
          billingName: paymentMethod.billing_details?.name || null,
          billingEmail: paymentMethod.billing_details?.email || null,
          billingPhone: paymentMethod.billing_details?.phone || null,
          cardSupports3dSecure: paymentMethod.three_d_secure_usage?.supported || false,
          cvvCheck: paymentMethod.card?.checks?.cvc_check || null,
          postalCodeCheck: paymentMethod.card?.checks?.postal_code_check || null,
          addressLine1Check: paymentMethod.card?.checks?.address_line1_check || null,
          createdAt: paymentMethod.created ? new Date(paymentMethod.created * 1000).toISOString() : null,
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
          billingReason: latestInvoice.billing_reason || null,
          paidAt: latestInvoice.status_transitions?.paid_at ? new Date(latestInvoice.status_transitions.paid_at * 1000).toISOString() : null,
          paymentAttempts: latestInvoice.attempt_count || null,
          periodStart: latestInvoice.period_start ? new Date(latestInvoice.period_start * 1000).toISOString() : null,
          periodEnd: latestInvoice.period_end ? new Date(latestInvoice.period_end * 1000).toISOString() : null,
          dueDate: latestInvoice.due_date ? new Date(latestInvoice.due_date * 1000).toISOString() : null,
          collectionMethod: latestInvoice.collection_method || null,
          lineItems: latestInvoice.lines?.data?.map(line => ({
            description: line.description || "Charge",
            amount: Math.round((line.amount || 0) / 100 * 100) / 100,
            quantity: line.quantity || 1,
          })) || null,
        } : null,
        
        // Plan/Product info
        planName: plan?.product?.name || null,
        productId: plan?.product?.id || null,
        scansPerDay: item?.metadata?.scansPerDay ? parseInt(item.metadata.scansPerDay) : null,
        billingInterval: plan?.interval || null,
        billingIntervalCount: plan?.interval_count || null,
        amount: plan?.amount ? plan.amount / 100 : null,
        
        // Collection & Billing
        collectionMethod: subscription.collection_method || null,
        nextBillingDate: item?.current_period_end ? new Date((item.current_period_end + (item.billing_thresholds?.usage_gte || 0)) * 1000).toISOString() : null,
        liveMode: subscription.livemode || false,
        
        // Dates
        customerCreatedAt: customer?.created ? new Date(customer.created * 1000).toISOString() : null,
        
        // Stripe IDs (for support reference)
        stripeCustomerId: user.stripe_customer_id,
        stripeSubscriptionId: user.stripe_subscription_id,
        stripePaymentMethodId: paymentMethod?.id || null,
        
        // Trial info
        hasTrialPeriod: !!subscription.trial_start,
        isOnTrial: subscription.trial_end ? new Date(subscription.trial_end * 1000) > new Date() : false,
      }
    })
  } catch (error) {
    console.error("[Billing] Error verifying code:", error)
    return NextResponse.json({ error: "Failed to verify code" }, { status: 500 })
  }
}
