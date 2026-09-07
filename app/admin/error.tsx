"use client";

import { Button } from "@/components/ui/button";
import { RouteError } from "@/components/shared/route-error";

/**
 * This was a hand-rolled copy of RouteError, and it had drifted from it three
 * ways: a different icon-plate radius (rounded-lg here, rounded-2xl there),
 * a different muted step on the digest line, and h-9 buttons against the
 * shared component's default. Two error screens that are the same screen
 * should not disagree about their own corners.
 *
 * The only thing this route genuinely needed that the shared one lacked was
 * the second button, since an admin looking at a crashed panel has somewhere
 * specific to go. That is an `action` prop now.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      area="Admin"
      title="Admin panel error"
      // Says what to do next. It used to say only that the error had been
      // logged, which tells an operator nothing they can act on: the digest
      // RouteError prints is the string that finds it in Error Logs.
      description="Something in this panel threw. It has been captured in Error Logs, so retry first, and if it happens again search that tab for the reference below."
      error={error}
      reset={reset}
      action={
        <Button asChild variant="outline">
          <a href="/admin?tab=error-logs">Open error logs</a>
        </Button>
      }
    />
  );
}
