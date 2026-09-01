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
      area="Dashboard"
      title="Couldn’t load the scanner"
      description="Something went wrong while loading the scanner. Any scan already running keeps going in the background."
      error={error}
      reset={reset}
    />
  );
}
