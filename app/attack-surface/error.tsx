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
      area="AttackSurface"
      title="Couldn’t load your attack surface"
      description="Something went wrong while loading your domains and hosts. Nothing has been removed."
      error={error}
      reset={reset}
    />
  );
}
