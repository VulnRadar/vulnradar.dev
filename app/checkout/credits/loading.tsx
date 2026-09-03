import { CreditTopUpSkeleton } from "@/components/billing/credits-skeleton";

/**
 * This segment only redirects to /ai-credits, but the parent /checkout
 * loading.tsx would otherwise flash the subscription checkout's two-column
 * skeleton on the way there. Show the shape that is actually coming.
 */
export default function Loading() {
  return <CreditTopUpSkeleton />;
}
