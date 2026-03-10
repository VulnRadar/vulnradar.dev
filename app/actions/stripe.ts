'use server'

import { stripe } from '@/lib/stripe'
import { PRODUCTS, getPlanFromProductId } from '@/lib/products'

export async function startCheckoutSession(productId: string, userEmail?: string) {
  const product = PRODUCTS.find((p) => p.id === productId)
  if (!product) {
    throw new Error(`Product with id "${productId}" not found`)
  }

  // Get the plan ID (e.g., "pro_supporter" from "pro_supporter_monthly")
  const planId = getPlanFromProductId(productId)

  // Create Checkout Session for subscription
  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded',
    redirect_on_completion: 'never',
    customer_email: userEmail,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: product.name,
            description: product.description,
          },
          unit_amount: product.priceInCents,
          recurring: {
            interval: product.interval,
          },
        },
        quantity: 1,
      },
    ],
    mode: 'subscription',
    // Store planId in session metadata for checkout.session.completed webhook
    metadata: {
      planId: planId,
      productId: product.id,
    },
    // Also store on subscription for subscription.* webhooks
    subscription_data: {
      metadata: {
        planId: planId,
        productId: product.id,
        scansPerDay: product.scansPerDay.toString(),
      },
    },
  })

  return session.client_secret
}
