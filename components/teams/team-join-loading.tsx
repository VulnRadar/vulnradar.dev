import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";

/**
 * The waiting state for /teams/join, in one place because it has three
 * callers: the page's own Suspense fallback, the page's "checking who you are
 * signed in as" branch, and the route fallback below.
 */
export function TeamJoinLoading({
  label = "Checking your invitation",
}: {
  label?: string;
}) {
  return (
    <div className="border-l-2 border-border pl-4" aria-busy="true">
      <div className="flex items-center gap-2.5">
        <Loader2
          className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
          aria-hidden="true"
        />
        {/* Hand-rolled because this state needs the spinner beside the title,
            but the size stays on AuthHeading's Tier B scale so the heading
            does not change size when the invitation resolves. */}
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-balance text-foreground">
          One moment
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mt-2" role="status">
        {label}
      </p>
    </div>
  );
}

/**
 * The route fallback for app/teams/join.
 *
 * Without one the segment inherited app/teams/loading.tsx, which draws the
 * teams list: app chrome, a page title, a New team button and five table rows.
 * /teams/join is an invitation card on the signed-out auth shell, so following
 * an invite link from an email drew a page the reader was never going to, then
 * replaced all of it.
 */
export function TeamJoinRouteSkeleton() {
  return (
    <AuthLayout>
      <TeamJoinLoading />
    </AuthLayout>
  );
}
