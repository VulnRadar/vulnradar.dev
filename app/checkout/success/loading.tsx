import { CheckoutReturningMessage } from "@/components/billing/checkout-message";

/**
 * Without this file the segment inherited app/checkout/loading.tsx, which
 * draws the payment page: a two-column grid with an order summary and a card
 * form. /checkout/success has neither, so returning from Stripe drew a
 * checkout the reader had already completed and then replaced all of it.
 */
export default function Loading() {
  return <CheckoutReturningMessage />;
}
