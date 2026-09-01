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
      area="Profile"
      title="Couldn’t load your profile"
      description="Something went wrong while loading your account settings. Nothing has been changed."
      error={error}
      reset={reset}
    />
  );
}
