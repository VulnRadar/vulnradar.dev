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

/**
 * The same list plus "canceling", which is ours and not Stripe's: the cancel
 * routes write it for a cancel-at-period-end subscription, which Stripe still
 * reports as "active" and is still very much a live subscription the customer
 * has access to and may reactivate.
 *
 * This is the answer to a different question than the one above. Not "does
 * this entitle the plan" but "is this users row still attached to a Stripe
 * subscription that has not ended", which is what decides whether a webhook
 * for some OTHER subscription is allowed to overwrite the row. Three call
 * sites had spelled it inline as `[...ACTIVE_SUBSCRIPTION_STATUSES,
 * "canceling"]`.
 */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = [
  ...ACTIVE_SUBSCRIPTION_STATUSES,
  "canceling",
];

export function isLiveSubscriptionStatus(
  status: string | null | undefined,
): boolean {
  return !!status && LIVE_SUBSCRIPTION_STATUSES.includes(status);
}
