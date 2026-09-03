import { CreditTopUpSkeleton } from "@/components/billing/credits-skeleton";

/** Redirect-only segment. See app/checkout/credits/loading.tsx. */
export default function Loading() {
  return <CreditTopUpSkeleton />;
}
