import Link from "next/link";

/**
 * Shown on the two public report pages. The site owner who lands on a report of
 * their own domain is the one reader with a reason to want it gone, and neither
 * page told them there was a way to do that.
 */
export function DomainTakedownLine() {
  return (
    <p className="text-xs text-muted-foreground">
      Own this domain?{" "}
      <Link
        href="/docs/sharing#domain-owner-controls"
        className="text-primary underline-offset-2 hover:underline"
      >
        Verify it to take this report down
      </Link>
      .
    </p>
  );
}
