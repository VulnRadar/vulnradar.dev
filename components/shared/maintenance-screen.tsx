import Link from "next/link";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME, ROUTES } from "@/lib/config/client-constants";
import { focus, transitions } from "@/lib/ui/animations";

/**
 * What a non-staff visitor sees while MAINTENANCE_MODE is on. Rendered by
 * app/layout.tsx in place of the page, so it replaces every route at once
 * rather than needing a redirect.
 *
 * Deliberately a server component with no state, no data fetching and no
 * event handlers. The situation this exists for is "the database is down",
 * so anything that would need a query, a session or a settings read would
 * take the maintenance page down alongside the app it is meant to stand in
 * for. Composition matches app/not-found.tsx and app/error.tsx.
 *
 * The sign-in link is not decoration: it is the route back in for a staff
 * member who arrives signed out, and /login stays reachable during
 * maintenance for exactly that reason.
 */
export function MaintenanceScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center gap-8">
        <div className="flex items-center gap-2.5">
          <ThemedLogo
            width={28}
            height={28}
            className="h-7 w-7"
            alt={`${APP_NAME} logo`}
          />
          <span className="text-xl font-mono font-semibold text-foreground tracking-tight">
            {APP_NAME}
          </span>
        </div>

        <div className="flex flex-col items-center gap-3 text-center border-y border-border/50 py-8 w-full">
          <p className="font-mono text-6xl font-semibold text-foreground tabular-nums">
            503
          </p>
          <h1 className="text-lg font-semibold text-foreground">
            Down for maintenance
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
            {message}
          </p>
        </div>

        <div className="flex gap-4 text-xs">
          <Link
            href={ROUTES.LOGIN}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${transitions.default} ${focus.ring}`}
          >
            Sign in
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <Link
            href={ROUTES.CHANGELOG}
            className={`text-primary hover:underline underline-offset-4 rounded-sm ${transitions.default} ${focus.ring}`}
          >
            Changelog
          </Link>
        </div>
      </div>
    </div>
  );
}
