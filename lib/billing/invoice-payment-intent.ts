import type Stripe from "stripe";

/**
 * The PaymentIntent id behind a paid invoice.
 *
 * Stripe removed `payment_intent` from the Invoice object. It is a field on
 * InvoicePayment now, reached through `invoice.payments.data[].payment`, and
 * the removal was not a rename we noticed: the call site read it through an
 * `as unknown as { payment_intent?: string }` cast, which is exactly the
 * idiom that survives a vendored type losing a field. A plain `as` would have
 * failed to compile on non-overlapping types. The double cast compiled, the
 * `?? null` beside it swallowed the undefined, and every billing_history row
 * written since the SDK upgrade recorded a NULL payment intent.
 *
 * Nothing crashed, which is why nobody found it. The symptom is only visible
 * later, when someone tries to reconcile a refund or open a charge in the
 * Stripe dashboard from an admin screen and there is no id to join on.
 *
 * Returns null when the invoice genuinely has no payment intent, which is a
 * real state: a zero-amount invoice, one paid out of band, or one settled by
 * a charge rather than a PaymentIntent (Stripe surfaces `charge` in that
 * case, and only for invoices finalized before March 2019).
 */
export function invoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data;
  if (!Array.isArray(payments)) return null;

  for (const entry of payments) {
    const payment = entry?.payment;
    if (!payment || payment.type !== "payment_intent") continue;
    const intent = payment.payment_intent;
    // Expanded or not: Stripe sends the bare id unless the caller asked for
    // expansion, and a webhook payload never has.
    if (typeof intent === "string") return intent;
    if (intent && typeof intent.id === "string") return intent.id;
  }

  return null;
}
