// Browserbase Credit Catalog (Source of Truth for one-time live-browser
// session minute top-ups)
//
// Separate from lib/billing/catalog.ts's PLANS/PRODUCTS: those are
// recurring subscriptions (Stripe mode: "subscription"). This is a real,
// single-payment Stripe PaymentIntent (mode: "payment", confirmed through
// Stripe Elements on app/checkout/browser-credits/page.tsx -- see
// app/actions/stripe.ts's createBrowserbaseCreditPaymentIntent/
// confirmBrowserbaseCreditPurchase) that tops up
// users.browserbase_credit_seconds_balance -- see
// lib/billing/browserbase-usage.ts for how that balance is spent (as a
// fallback only, once the plan's free browserbaseMinutesPerMonth allowance
// is exhausted for the current calendar month) and that same file's
// creditBrowserbaseCreditPurchase for how a paid PaymentIntent actually
// credits it.
//
// A "buy more, save more" ladder, same shape as ai-credit-catalog.ts and
// github-credit-catalog.ts: the minutes-per-dollar rate strictly increases
// with price. UNLIKE those two, Browserbase is a real paid third-party API
// with a real per-minute wholesale cost VulnRadar pays regardless of
// whether it's subsidized elsewhere -- these tier prices are a starting
// ladder shape, not a verified-profitable price list. Check them against
// the actual Browserbase invoice rate before relying on this in
// production; they should be repriced (raised, if needed) so the cheapest
// tier still clears cost with real margin.

export interface BrowserbaseCreditTier {
  /** Stable id threaded through Stripe metadata end-to-end (PaymentIntent
   *  creation -> webhook/action credit, see
   *  createBrowserbaseCreditPaymentIntent and the webhook's
   *  payment_intent.succeeded handler). Never reuse a retired id for a
   *  different price/minute amount -- an already-created Stripe Price for
   *  that id would silently no longer match this catalog. */
  id: string;
  minutes: number;
  priceInCents: number;
}

export const BROWSERBASE_CREDIT_TIERS: readonly BrowserbaseCreditTier[] = [
  {
    id: "browserbase_credits_30m",
    minutes: 30,
    priceInCents: 500,
  },
  {
    id: "browserbase_credits_100m",
    minutes: 100,
    priceInCents: 1500,
  },
  {
    id: "browserbase_credits_220m",
    minutes: 220,
    priceInCents: 3000,
  },
  {
    id: "browserbase_credits_500m",
    minutes: 500,
    priceInCents: 6000,
  },
];

export function getBrowserbaseCreditTier(
  id: string,
): BrowserbaseCreditTier | undefined {
  return BROWSERBASE_CREDIT_TIERS.find((t) => t.id === id);
}
