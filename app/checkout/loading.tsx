import { CheckoutSkeleton } from "@/components/billing/checkout-skeleton";

/**
 * The checkout route already had a skeleton shaped like its real two-column
 * layout, used only for its own in-page auth check. Without this file the
 * route transition itself had no loading state, so clicking Upgrade left the
 * previous page on screen with nothing happening on the revenue path of all
 * places.
 */
export default function Loading() {
  return <CheckoutSkeleton />;
}
