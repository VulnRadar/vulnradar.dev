/**
 * Whether a thrown Stripe error means "this object does not exist" as opposed
 * to "I could not reach Stripe just now".
 *
 * The distinction is the whole point. Billing code repeatedly retrieves an
 * object to decide whether to create a replacement, and a bare catch answers
 * that question wrong: a timeout, a 500 or a rate limit all read as "gone", so
 * the code goes on to create a second subscription beside the one already
 * billing the customer, or a second customer that orphans the first one's
 * subscription. Only a genuine resource_missing is safe to act on. Everything
 * else has to keep propagating, so the operation fails where somebody can see
 * it and retry, rather than quietly succeeding at the wrong thing.
 *
 * Its own file rather than lib/billing/stripe.ts because that module is
 * server-only and this is a pure predicate over a value.
 */
export function isMissingStripeResource(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; statusCode?: unknown };
  return e.code === "resource_missing" || e.statusCode === 404;
}
