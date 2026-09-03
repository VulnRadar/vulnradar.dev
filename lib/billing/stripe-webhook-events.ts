/**
 * The Stripe events the webhook handler acts on.
 *
 * Split out of `stripe-webhook-setup.ts` so it can be read without that
 * module's `server-only` marker and its Stripe/database imports. The
 * self-hosting docs render this list for the "create the webhook by hand in
 * the Stripe dashboard" path: that list was hand-written and had drifted three
 * events behind, so an operator who followed it got a webhook that never
 * delivered `payment_intent.succeeded`, `charge.refunded` or
 * `charge.dispute.created`, and one-time credits were neither backfilled nor
 * clawed back on a refund.
 *
 * Keep it in sync with the switch in app/api/v3/webhooks/stripe/route.ts: an
 * event the handler reads but that is not registered here never arrives.
 * `ensureStripeWebhook` re-checks this list on every boot and updates an
 * existing endpoint to add anything missing, so adding an event here is enough
 * to backfill it onto a live webhook.
 */
export const REQUIRED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  // One-time credit purchases (AI / GitHub / Browserbase): the webhook's
  // backup crediting path. Was handled but never registered here, so the
  // backup only ever ran if the fast confirm path also happened to.
  "payment_intent.succeeded",
  // Claw one-time credits back on a refund or chargeback.
  "charge.refunded",
  "charge.dispute.created",
] as const;
