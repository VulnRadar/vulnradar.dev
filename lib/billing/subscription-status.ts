/**
 * Stripe subscription statuses that entitle a user to their plan's real
 * feature limits and premium badge -- the single canonical answer to "is
 * this subscription currently paying," used identically by the checkout
 * action (app/actions/stripe.ts) and the webhook handler
 * (app/api/v3/webhooks/stripe/route.ts) so the two can never drift into
 * disagreeing about it again.
 *
 * "past_due" is included deliberately: it means a renewal payment failed
 * on a subscription that WAS already paying, and Stripe itself gives a
 * multi-day retry window before actually canceling. Treating that the same
 * as "never paid" (incomplete) would cut off a paying customer's access
 * over a single failed card charge instead of during Stripe's own grace
 * period. Every other status ("incomplete", "incomplete_expired",
 * "unpaid", "canceled") means the account should be on "free".
 */
export const ACTIVE_SUBSCRIPTION_STATUSES: readonly string[] = [
  "active",
  "trialing",
  "past_due",
];
