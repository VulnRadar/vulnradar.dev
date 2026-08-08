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
 * Check if Stripe is enabled and configured.
 *
 * Deliberately left synchronous reading the shipped BILLING_ENABLED
 * constant rather than resolving it through the admin settings resolver
 * (lib/config/runtime-config.ts). getStripe()/isStripeEnabled() are called
 * synchronously from ~15 call sites across the codebase (server actions,
 * webhook handlers, checkout routes) well outside this pass's owned files;
 * making them async would require converting every one of those callers in
 * the same change, which is out of scope here. The BILLING_ENABLED checks
 * that gate server-side logic *within this pass's owned files* (the daily
 * scan limit in lib/rate-limiting/daily-limits.ts, the billing route, the
 * webhook/product setup routes) are wired to the resolver; this one is not.
 */
export function isStripeEnabled(): boolean {
  return BILLING_ENABLED && !!process.env.STRIPE_SECRET_KEY;
}
