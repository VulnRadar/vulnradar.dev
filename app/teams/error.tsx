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
      area="Teams"
      title="Couldn’t load your teams"
      description="Something went wrong while loading your teams. No membership has changed."
      error={error}
      reset={reset}
    />
  );
}
