import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";

/**
 * The one caller of CheckoutSkeleton, and the reason it still exists: at this
 * point the route's JavaScript has not arrived, so nothing yet knows which
 * plan is being bought. Once CheckoutPage is mounted it draws the heading and
 * order summary from PRODUCTS immediately and only the payment column waits.
 *
 * Without this file the route transition itself had no loading state, so
 * clicking Upgrade left the previous page on screen with nothing happening, on
 * the revenue path of all places.
 */
export default function Loading() {
  return <CheckoutSkeleton />;
}
