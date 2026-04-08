import 'server-only'
import Stripe from 'stripe'
import { BILLING_ENABLED } from '@/lib/config/constants'

let stripeInstance: Stripe | null = null

export const stripe = new Proxy({} as Stripe, {
    get(_, prop) {
        if (!stripeInstance) {
            const key = process.env.STRIPE_SECRET_KEY

            if (!key) {
                throw new Error("STRIPE_SECRET_KEY is not set")
            }

            stripeInstance = new Stripe(key)
        }

        return stripeInstance[prop as keyof Stripe]
    },
})

/**
 * Check if Stripe is enabled and configured
 */
export function isStripeEnabled(): boolean {
  return BILLING_ENABLED && !!process.env.STRIPE_SECRET_KEY
}
