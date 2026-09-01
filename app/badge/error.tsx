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
      area="Badge"
      title="Couldn’t load the badge builder"
      description="Something went wrong while loading this page. Any badge already embedded on your site keeps working."
      error={error}
      reset={reset}
    />
  );
}
