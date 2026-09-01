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
      area="Repos"
      title="Couldn’t load your repositories"
      description="Something went wrong while loading your connected repositories. Your GitHub connection is unaffected."
      error={error}
      reset={reset}
    />
  );
}
