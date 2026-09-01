/**
 * The retry ladder every Stripe confirmation in this app walks after the
 * browser's confirmPayment()/confirmSetup() resolves.
 *
 * Confirming with Stripe is not instant: an async payment method, or a
 * webhook the backend is still processing, can leave the intent
 * unresolved for a second or two after the browser call returns. Each of
 * the four checkout components used to carry its own copy of this array,
 * which meant the total budget below was an unnamed property of four
 * duplicated literals: changing one and not the others would have given
 * subscriptions and credit top-ups different definitions of "we waited
 * long enough", with no name to grep for.
 *
 * Six attempts in total (one immediate, then one after each delay), so the
 * ladder gives up after 8 seconds of waiting plus the request time of six
 * confirmations. Past that the UI stops guessing and says "pending"
 * rather than showing a checkmark it cannot stand behind.
 */
export const CHECKOUT_CONFIRM_BACKOFF_MS = [
  500, 1000, 1500, 2000, 3000,
] as const;
