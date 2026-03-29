import "server-only"

import { stripe } from "./stripe"
import { BILLING_ENABLED } from "./constants"

// Events we need for billing
const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const

// Cache to avoid repeated API calls
let webhookSetupPromise: Promise<{ success: boolean; webhookId?: string; error?: string }> | null = null

/**
 * Ensures a webhook endpoint exists for this app instance.
 * Creates one if it doesn't exist, or returns existing webhook info.
 * 
 * This function is idempotent - safe to call multiple times.
 */
export async function ensureStripeWebhook(): Promise<{
  success: boolean
  webhookId?: string
  webhookSecret?: string
  error?: string
  alreadyExists?: boolean
}> {
  // Skip if billing is disabled
  if (!BILLING_ENABLED) {
    return { success: true, error: "Billing is disabled - webhook not needed" }
  }

  // Check required env vars
  const secretKey = process.env.STRIPE_SECRET_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  if (!secretKey) {
    return { success: false, error: "STRIPE_SECRET_KEY is not set" }
  }

  if (!appUrl) {
    return { success: false, error: "NEXT_PUBLIC_APP_URL is not set" }
  }

  const webhookUrl = `${appUrl}/api/v2/webhooks/stripe`

  try {
    // List existing webhooks to check if ours already exists
    const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 })
    
    const existingWebhook = existingWebhooks.data.find(
      (wh) => wh.url === webhookUrl && wh.status === "enabled"
    )

    if (existingWebhook) {
      // Webhook already exists - check if it has all required events
      const hasAllEvents = REQUIRED_EVENTS.every((event) =>
        existingWebhook.enabled_events?.includes(event as Stripe.WebhookEndpoint.EnabledEvent)
      )

      if (hasAllEvents) {
        return {
          success: true,
          webhookId: existingWebhook.id,
          alreadyExists: true,
        }
      }

      // Update webhook to include all required events
      const updated = await stripe.webhookEndpoints.update(existingWebhook.id, {
        enabled_events: REQUIRED_EVENTS as unknown as Stripe.WebhookEndpoint.EnabledEvent[],
      })

      return {
        success: true,
        webhookId: updated.id,
        alreadyExists: true,
      }
    }

    // Create new webhook endpoint
    const newWebhook = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: REQUIRED_EVENTS as unknown as Stripe.WebhookEndpoint.EnabledEvent[],
      description: `VulnRadar billing webhook - auto-created for ${appUrl}`,
    })

    return {
      success: true,
      webhookId: newWebhook.id,
      webhookSecret: newWebhook.secret,
      alreadyExists: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[Stripe Webhook Setup] Error:", message)
    return { success: false, error: message }
  }
}

/**
 * Cached version of ensureStripeWebhook - only runs once per server instance
 */
export function ensureStripeWebhookOnce(): Promise<{
  success: boolean
  webhookId?: string
  webhookSecret?: string
  error?: string
  alreadyExists?: boolean
}> {
  if (!webhookSetupPromise) {
    webhookSetupPromise = ensureStripeWebhook()
  }
  return webhookSetupPromise
}

// Type import for Stripe
import type Stripe from "stripe"
