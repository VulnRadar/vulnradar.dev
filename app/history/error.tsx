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
      area="History"
      title="Couldn’t load your scan history"
      description="Something went wrong while loading your scans. Nothing has been deleted."
      error={error}
      reset={reset}
    />
  );
}
