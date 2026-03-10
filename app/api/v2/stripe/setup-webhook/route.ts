import { NextResponse } from "next/server"
import { ensureStripeWebhook } from "@/lib/stripe-webhook-setup"
import { BILLING_ENABLED } from "@/lib/constants"

export const dynamic = "force-dynamic"

/**
 * GET /api/v2/stripe/setup-webhook
 * 
 * Ensures the Stripe webhook is configured for this app instance.
 * Creates one if it doesn't exist, or returns existing webhook info.
 * 
 * This endpoint is idempotent - safe to call multiple times.
 * 
 * IMPORTANT: If a new webhook is created, you'll need to manually copy
 * the webhook secret to your STRIPE_WEBHOOK_SECRET environment variable.
 * The secret is only returned when the webhook is first created.
 */
export async function GET() {
  if (!BILLING_ENABLED) {
    return NextResponse.json({
      success: true,
      message: "Billing is disabled in config.yaml - webhook setup skipped",
      billingEnabled: false,
    })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const hasSecretKey = !!process.env.STRIPE_SECRET_KEY
  const hasWebhookSecret = !!process.env.STRIPE_WEBHOOK_SECRET

  if (!hasSecretKey) {
    return NextResponse.json({
      success: false,
      error: "STRIPE_SECRET_KEY environment variable is not set",
      billingEnabled: true,
    }, { status: 500 })
  }

  if (!appUrl) {
    return NextResponse.json({
      success: false,
      error: "NEXT_PUBLIC_APP_URL environment variable is not set",
      billingEnabled: true,
    }, { status: 500 })
  }

  const result = await ensureStripeWebhook()

  if (!result.success) {
    return NextResponse.json({
      success: false,
      error: result.error,
      billingEnabled: true,
    }, { status: 500 })
  }

  // Build response
  const response: Record<string, unknown> = {
    success: true,
    billingEnabled: true,
    webhookUrl: `${appUrl}/api/v2/webhooks/stripe`,
    webhookId: result.webhookId,
    alreadyExists: result.alreadyExists,
    webhookSecretConfigured: hasWebhookSecret,
  }

  // Only include webhook secret if it was just created (for manual copying)
  if (result.webhookSecret && !result.alreadyExists) {
    response.webhookSecret = result.webhookSecret
    response.message = "NEW WEBHOOK CREATED! Copy the webhookSecret to your STRIPE_WEBHOOK_SECRET environment variable."
  } else if (result.alreadyExists) {
    response.message = hasWebhookSecret 
      ? "Webhook already exists and STRIPE_WEBHOOK_SECRET is configured"
      : "Webhook already exists. Make sure STRIPE_WEBHOOK_SECRET is set in your environment."
  }

  return NextResponse.json(response)
}
