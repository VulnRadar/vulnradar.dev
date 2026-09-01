"use client";

import { RouteError } from "@/components/shared/route-error";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      area="Checkout"
      title="Couldn’t load checkout"
      description="Something went wrong before the payment form loaded. Nothing has been charged."
      error={error}
      reset={reset}
    />
  );
}
