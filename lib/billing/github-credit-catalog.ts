// GitHub Review Credit Catalog (Source of Truth for one-time GitHub repo AI
// review token top-ups)
//
// Mirrors lib/billing/ai-credit-catalog.ts exactly -- same tier prices, same
// token amounts, same "buy more, save more" ladder -- kept as its own file
// and its own Stripe metadata key (githubCreditTierId, not aiCreditTierId)
// rather than folded into the AI credit catalog, since it tops up a
// completely separate balance (users.github_credit_balance) spent by a
// completely separate quota (githubReviewTokensPerWindow, see
// lib/billing/github-review-usage.ts) with its own idempotency ledger
// (github_credit_purchases). Same token-per-dollar rate as AI credits: the
// underlying AI provider call costs the same per token regardless of which
// feature spent it, so there's no reason for the two catalogs' rates to
// diverge.
//   - $10  ->  1,000,000 tokens (100,000 tokens/$, base rate)
//   - $25  ->  3,000,000 tokens (120,000 tokens/$, 1.2x base)
//   - $50  ->  8,000,000 tokens (160,000 tokens/$, 1.6x base)
//   - $100 -> 20,000,000 tokens (200,000 tokens/$, 2.0x base)

export interface GithubCreditTier {
  /** Stable id threaded through Stripe metadata end-to-end (PaymentIntent
   *  creation -> webhook/action credit, see createGithubCreditPaymentIntent
   *  and the webhook's payment_intent.succeeded handler). Never reuse a
   *  retired id for a different price/token amount -- an already-created
   *  Stripe Price for that id would silently no longer match this catalog. */
  id: string;
  tokens: number;
  priceInCents: number;
}

export const GITHUB_CREDIT_TIERS: readonly GithubCreditTier[] = [
  {
    id: "github_credits_1m",
    tokens: 1_000_000,
    priceInCents: 1000,
  },
  {
    id: "github_credits_3m",
    tokens: 3_000_000,
    priceInCents: 2500,
  },
  {
    id: "github_credits_8m",
    tokens: 8_000_000,
    priceInCents: 5000,
  },
  {
    id: "github_credits_20m",
    tokens: 20_000_000,
    priceInCents: 10000,
  },
];

export function getGithubCreditTier(id: string): GithubCreditTier | undefined {
  return GITHUB_CREDIT_TIERS.find((t) => t.id === id);
}
