export type StripeMode = "live" | "test" | "unknown";

/**
 * Which Stripe environment the configured secret key talks to, read from the
 * key's own prefix.
 *
 * A subscription id that "does not exist" is the classic symptom of a key from
 * the wrong environment: a live key asked about a test-mode subscription, or
 * the reverse after a database was copied between deployments. Putting the
 * mode next to the missing id in the log and the alert is what lets whoever
 * reads it tell that apart from a genuinely deleted subscription.
 *
 * Only the prefix is inspected and only the mode leaves this function: the
 * key itself never goes into a log line.
 */
export function stripeKeyMode(
  key: string | undefined = process.env.STRIPE_SECRET_KEY,
): StripeMode {
  if (!key) return "unknown";
  // sk_ is a standard secret key, rk_ a restricted one; both carry the mode.
  if (/^(?:sk|rk)_live_/.test(key)) return "live";
  if (/^(?:sk|rk)_test_/.test(key)) return "test";
  return "unknown";
}
