import "server-only";
import type Stripe from "stripe";
import type { Product } from "@/lib/billing/catalog";

/**
 * Finds this catalog Product's Stripe Product+Price, creating them once if
 * they don't exist yet, and reusing them on every later call.
 *
 * createSubscription() used to call stripe.prices.create() with an inline
 * product_data on every single checkout attempt -- Stripe's API treats that
 * as "create a brand new Product for this price," so every checkout (every
 * retry, every plan click) left behind a fresh throwaway Product cluttering
 * the Stripe dashboard. This mirrors the search-then-create logic
 * app/api/v3/stripe/setup-products/route.ts already used for its one-time
 * admin setup, so checkout now reuses the exact same catalog entries
 * instead of minting new ones.
 */
export async function getOrCreateStripePriceId(
  stripe: Stripe,
  product: Product,
): Promise<string> {
  const existingProducts = await stripe.products.search({
    query: `metadata['vulnradar_id']:'${product.id}'`,
  });

  const stripeProduct =
    existingProducts.data[0] ??
    (await stripe.products.create({
      name: product.name,
      description: product.description,
      metadata: {
        vulnradar_id: product.id,
        scans_per_day: product.scansPerDay.toString(),
      },
    }));

  const existingPrices = await stripe.prices.list({
    product: stripeProduct.id,
    active: true,
  });
  const matchingPrice = existingPrices.data.find(
    (p) =>
      p.unit_amount === product.priceInCents &&
      p.recurring?.interval === product.interval,
  );
  if (matchingPrice) return matchingPrice.id;

  const stripePrice = await stripe.prices.create({
    product: stripeProduct.id,
    unit_amount: product.priceInCents,
    currency: "usd",
    recurring: { interval: product.interval },
    metadata: { vulnradar_id: product.id },
  });
  return stripePrice.id;
}
