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
      area="Contact"
      title="Couldn’t load this page"
      description="Something went wrong while loading the contact page. Your existing tickets are unaffected."
      error={error}
      reset={reset}
    />
  );
}
