import pool from "@/lib/database/db";
import { getStripe } from "@/lib/billing/stripe";
import { isMissingStripeResource } from "@/lib/billing/stripe-errors";
import { logError, type LogContext } from "@/lib/logging/log";

/** Stripe statuses after which no further charge can happen. */
const ENDED_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired"]);

async function nullIfMissing<T>(
  call: Promise<T>,
  ctx: LogContext,
): Promise<T | null> {
  try {
    return await call;
  } catch (err) {
    if (!isMissingStripeResource(err)) throw err;
    // Not a refusal, but it gets a line: the row is about to go, so this is
    // the last record of the id. Stripe's own message says whether the object
    // is really gone or the key points at the wrong environment, which makes
    // every object look gone while the real subscription keeps billing.
    logError("billing", "Stripe has no record of this object", err, ctx);
    return null;
  }
}

/**
 * Stops everything Stripe would go on charging this account for. Both delete
 * paths call it before their transaction, and answer a retryable error instead
 * of deleting when it returns false.
 *
 * The order is the point. Deleting the row destroys the only record linking
 * the person to their Stripe customer, so a subscription still live at that
 * moment renews for as long as the card works, and nobody here can find it to
 * stop it. The reverse failure is cheap: a subscription cancelled ahead of a
 * delete that then fails is reported by the customer.subscription.deleted
 * webhook like any other cancellation, and the account simply lands on its
 * floor plan.
 *
 * Every live subscription on the customer goes, not only the one on the row.
 * A customer can hold a second one the row lost track of, and it bills the
 * same card. Listing without a status filter is what includes past_due and
 * unpaid, which `status: "active"` would leave running.
 *
 * Safe to run twice: a subscription ended by an earlier attempt is skipped, so
 * retrying after a partial failure finishes the job. An object Stripe has no
 * record of is nothing to cancel, but any other failure (a timeout, a 500, a
 * rate limit) means we do not know what is still billing, so it refuses.
 *
 * No Stripe configured means a self-hosted deployment without billing, where
 * nothing can be cancelled and the delete goes ahead as it always has.
 */
export async function cancelSubscriptionsBeforeDeletion(
  userId: number,
): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return true;

  try {
    const { rows } = await pool.query<{
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
    }>(
      "SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id = $1",
      [userId],
    );
    const storedId = rows[0]?.stripe_subscription_id ?? null;
    const customerId = rows[0]?.stripe_customer_id ?? null;

    const live = new Set<string>();
    if (customerId) {
      // The list carries ended rows too (an abandoned checkout leaves an
      // incomplete_expired one), so a live subscription can sit past page one.
      let startingAfter: string | undefined;
      let hasMore = true;
      while (hasMore) {
        const page = await nullIfMissing(
          stripe.subscriptions.list({
            customer: customerId,
            limit: 100,
            ...(startingAfter ? { starting_after: startingAfter } : {}),
          }),
          { userId, stripeCustomerId: customerId },
        );
        for (const subscription of page?.data ?? []) {
          if (!ENDED_SUBSCRIPTION_STATUSES.has(subscription.status)) {
            live.add(subscription.id);
          }
        }
        startingAfter = page?.data[page.data.length - 1]?.id;
        hasMore = !!page?.has_more && !!startingAfter;
      }
    }
    if (storedId && !live.has(storedId)) {
      const stored = await nullIfMissing(
        stripe.subscriptions.retrieve(storedId),
        { userId, subscriptionId: storedId },
      );
      if (stored && !ENDED_SUBSCRIPTION_STATUSES.has(stored.status)) {
        live.add(stored.id);
      }
    }

    for (const id of live) {
      await nullIfMissing(stripe.subscriptions.cancel(id), {
        userId,
        subscriptionId: id,
      });
    }
    return true;
  } catch (err) {
    logError(
      "billing",
      "could not cancel the subscription, so the account was not deleted",
      err,
      { userId },
    );
    return false;
  }
}
