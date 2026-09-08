import type Stripe from "stripe";

/**
 * The subscription an invoice was raised for, or null when it was not raised
 * for one at all.
 *
 * Companion to invoicePaymentIntentId in this directory, and it exists for the
 * same reason: Stripe moved the field. `invoice.subscription` was a top-level
 * string; it now lives under `invoice.parent.subscription_details.subscription`
 * and is absent from the current Invoice type entirely. An account still
 * pinned to an older API version keeps sending the old shape in its webhook
 * payloads, so both have to be read.
 *
 * Null is a real, common answer, not a failure: a one-off invoice, an invoice
 * item billed on its own, a quote. Callers must treat it as "this invoice says
 * nothing about any subscription" and leave subscription state alone, which is
 * exactly what the invoice webhooks used to get wrong.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const fromParent = invoice.parent?.subscription_details?.subscription;
  if (typeof fromParent === "string") return fromParent;
  if (fromParent && typeof fromParent.id === "string") return fromParent.id;

  // Pre-2025 API versions, still sent by an account pinned to one.
  const legacy = (invoice as unknown as { subscription?: unknown })
    .subscription;
  if (typeof legacy === "string" && legacy) return legacy;
  if (
    legacy &&
    typeof legacy === "object" &&
    typeof (legacy as { id?: unknown }).id === "string"
  ) {
    return (legacy as { id: string }).id;
  }

  // Last resort: a subscription invoice always has at least one line item
  // carrying the same id, and this survives shapes the two paths above miss.
  for (const line of invoice.lines?.data ?? []) {
    const fromLine = line.parent?.subscription_item_details?.subscription;
    if (typeof fromLine === "string" && fromLine) return fromLine;
  }

  return null;
}
