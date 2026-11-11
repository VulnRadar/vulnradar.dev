import "server-only";
import type Stripe from "stripe";
import {
  getPlanFromProductId,
  type PlanId,
  type Product,
} from "@/lib/billing/catalog";
import { isMissingStripeResource } from "@/lib/billing/stripe-errors";

/**
 * The metadata key that ties a Stripe Product or Price back to our catalog id
 * (e.g. "pro_supporter_monthly"). getOrCreateStripePriceId below writes it on
 * both, and searches by it.
 */
export const STRIPE_CATALOG_ID_KEY = "vulnradar_id";

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
        [STRIPE_CATALOG_ID_KEY]: product.id,
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
    metadata: { [STRIPE_CATALOG_ID_KEY]: product.id },
  });
  return stripePrice.id;
}

/** A catalog or plan id to the paid plan it names, or "" for none. */
function paidPlanFrom(id: string | null | undefined): PlanId | "" {
  if (!id) return "";
  const plan = getPlanFromProductId(id);
  return plan === "free" ? "" : plan;
}

/**
 * The plan a catalog id in Stripe metadata names. `productId` is the key the
 * inline product_data checkout stamped before products were reused through
 * getOrCreateStripePriceId; a subscription that old can still be billing.
 */
function paidPlanFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): PlanId | "" {
  return (
    paidPlanFrom(metadata?.[STRIPE_CATALOG_ID_KEY]) ||
    paidPlanFrom(metadata?.productId)
  );
}

/**
 * Which paid plan a subscription is for, or "" when nothing names one.
 *
 * The billed price decides, because it is what the customer is charged for.
 * Subscription metadata is stamped once at checkout and nothing updates it, so
 * a plan change made in Stripe (the dashboard, the billing portal, a price
 * swap) left it naming the old plan, and reading it first meant the change was
 * never applied. It is the last resort, for a subscription whose price and
 * product carry no catalog id.
 *
 * A product given only by id is fetched. One Stripe genuinely does not have
 * names nothing; any other failure is thrown, because "" resolves the caller to
 * free, and a timeout must not downgrade a paying customer. The caller lets it
 * 500 so Stripe redelivers.
 */
export async function resolvePlanFromStripeSubscription(
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<PlanId | ""> {
  const price = subscription.items?.data?.[0]?.price;
  const fromPrice = paidPlanFromMetadata(price?.metadata);
  if (fromPrice) return fromPrice;

  const product = price?.product;
  if (product && typeof product === "object") {
    if (!("deleted" in product && product.deleted)) {
      const fromProduct = paidPlanFromMetadata(
        (product as Stripe.Product).metadata,
      );
      if (fromProduct) return fromProduct;
    }
  } else if (typeof product === "string" && product) {
    try {
      const fetched = await stripe.products.retrieve(product);
      const fromProduct = paidPlanFromMetadata(fetched.metadata);
      if (fromProduct) return fromProduct;
    } catch (err) {
      if (!isMissingStripeResource(err)) throw err;
      console.error("[Stripe] Billed product no longer exists:", err);
    }
  }

  return (
    paidPlanFrom(subscription.metadata?.planId) ||
    paidPlanFrom(subscription.metadata?.productId)
  );
}

// getOrCreateAiCreditPriceId (a one-time-Price equivalent of the function
// above, for lib/billing/ai-credit-catalog.ts's tiers) used to back
// createAiCreditCheckout's Stripe Checkout Session in app/actions/stripe.ts.
// That flow was replaced by createAiCreditPaymentIntent, which creates a raw
// PaymentIntent directly (see app/checkout/credits/page.tsx and
// components/billing/ai-credit-checkout.tsx) and has no Stripe Price object
// to look up or create -- removed along with it rather than left as
// unreachable code.
