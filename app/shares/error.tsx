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
      area="Shares"
      title="Couldn’t load shared scans"
      description="Something went wrong while loading your shared scans. The share links themselves still work."
      error={error}
      reset={reset}
    />
  );
}
