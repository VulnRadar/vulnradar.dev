import "server-only";
import Stripe from "stripe";
import { BILLING_ENABLED } from "@/lib/config/constants";

let stripeInstance: Stripe | null = null;

/**
 * R1: Lazy accessor returning the Stripe SDK instance or null when not
 * configured. Callers should pair this with isStripeEnabled() at the
 * top of their handler so they can return a typed 503-style response
 * instead of crashing on first property access.
 */
export function getStripe(): Stripe | null {
  if (!isStripeEnabled()) return null;
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeInstance = new Stripe(key);
  return stripeInstance;
}

/**
 * Check if Stripe is enabled and configured
 */
export function isStripeEnabled(): boolean {
  return BILLING_ENABLED && !!process.env.STRIPE_SECRET_KEY;
}
