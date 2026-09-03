"use client";

import { Suspense } from "react";
import { CheckoutReturningMessage } from "@/components/billing/checkout-message";
import { CheckoutSuccessContent } from "./checkout-success-content";

export default function CheckoutSuccessPage() {
  // The same element app/checkout/success/loading.tsx renders, so the route
  // fallback and this boundary are one shape rather than two: the local copy
  // that stood here was a bare "Loading..." heading with no h1 and different
  // spacing, which the route transition then replaced.
  return (
    <Suspense fallback={<CheckoutReturningMessage />}>
      <CheckoutSuccessContent />
    </Suspense>
  );
}
