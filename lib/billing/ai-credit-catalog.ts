// AI Credit Catalog (Source of Truth for one-time AI verification token
// top-ups)
//
// Separate from lib/billing/catalog.ts's PLANS/PRODUCTS: those are
// recurring subscriptions (Stripe mode: "subscription"). This is a real,
// single-payment Stripe PaymentIntent (mode: "payment", confirmed through
// Stripe Elements on app/checkout/credits/page.tsx -- see
// app/actions/stripe.ts's createAiCreditPaymentIntent/
// confirmAiCreditPurchase) that tops up users.ai_credit_balance -- see
// lib/billing/ai-usage.ts for how that balance is spent (as a fallback only
// once the plan's free aiTokensPerWindow allowance is exhausted for the
// current window) and lib/billing/ai-usage.ts's creditAiCreditPurchase for
// how a paid PaymentIntent actually credits it.
//
// A real "buy more, save more" ladder, not a single tier: the token-per-
// dollar rate strictly increases with price, spanning $10 to $100. Sized
// against the CURRENT (post-4x-increase) per-window aiTokensPerWindow plan
// allowances in lib/config/config-values.ts (Free 80K, Core 400K, Pro 2M,
// Elite 8M) so even the cheapest tier reads as a real, tangible boost
// rather than a token amount too small to matter next to those numbers:
//   - $10  ->  1,000,000 tokens (100,000 tokens/$, base rate)
//   - $25  ->  3,000,000 tokens (120,000 tokens/$, 1.2x base)
//   - $50  ->  8,000,000 tokens (160,000 tokens/$, 1.6x base)
//   - $100 -> 20,000,000 tokens (200,000 tokens/$, 2.0x base)
// A tier array (not a single hardcoded constant) so a new tier is just
// another entry here, no call-site refactor needed.

export interface AiCreditTier {
  /** Stable id threaded through Stripe metadata end-to-end (PaymentIntent
   *  creation -> webhook/action credit, see createAiCreditPaymentIntent and
   *  the webhook's payment_intent.succeeded handler). Never reuse a retired
   *  id for a different price/token amount -- an already-created Stripe
   *  Price for that id would silently no longer match this catalog. */
  id: string;
  tokens: number;
  priceInCents: number;
}

export const AI_CREDIT_TIERS: readonly AiCreditTier[] = [
  {
    id: "ai_credits_1m",
    tokens: 1_000_000,
    priceInCents: 1000,
  },
  {
    id: "ai_credits_3m",
    tokens: 3_000_000,
    priceInCents: 2500,
  },
  {
    id: "ai_credits_8m",
    tokens: 8_000_000,
    priceInCents: 5000,
  },
  {
    id: "ai_credits_20m",
    tokens: 20_000_000,
    priceInCents: 10000,
  },
];

export function getAiCreditTier(id: string): AiCreditTier | undefined {
  return AI_CREDIT_TIERS.find((t) => t.id === id);
}
