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
      area="PublicScans"
      title="Couldn’t load the public scan directory"
      description="Something went wrong while loading recent public scans. Try again in a moment."
      error={error}
      reset={reset}
    />
  );
}
