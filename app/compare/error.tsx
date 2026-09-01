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
      area="Compare"
      title="Couldn’t load the comparison"
      description="Something went wrong while loading this page. Your scans are unaffected."
      error={error}
      reset={reset}
    />
  );
}
