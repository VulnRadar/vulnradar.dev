import type Stripe from "stripe";

/**
 * Ends a Stripe subscription now, with no proration credit and no closing
 * invoice: the period the customer already paid for is not refunded, which is
 * the policy the cancel dialog and /docs/billing state.
 *
 * The one implementation of "cancel immediately". There were two: POST
 * /billing called subscriptions.cancel, while the route the Billing tab
 * actually uses moved cancel_at to the current time, which Stripe runs under the
 * default proration setting, so the button credited the unused time back and
 * the two endpoints gave the same customer different money outcomes
 * (sec-money-6). tests/app/api/v3/billing/one-cancel-implementation.test.ts
 * keeps every other direct call out.
 *
 * The Stripe instance is passed in rather than resolved here so a test that
 * fakes getStripe() exercises this exact call.
 */
export function cancelSubscriptionNow(
  stripe: Stripe,
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  return stripe.subscriptions.cancel(subscriptionId, {
    prorate: false,
    invoice_now: false,
  });
}
