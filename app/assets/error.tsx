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
      area="Assets"
      title="Couldn’t load your assets"
      description="Something went wrong while loading the hosts you have scanned. Nothing has been lost."
      error={error}
      reset={reset}
    />
  );
}
