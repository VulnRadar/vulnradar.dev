import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors GithubSection's real layout (heading, connection status card,
 * repo list) so the connection-status fetch's loading state doesn't reflow
 * into a differently-shaped section once it resolves.
 */
export function GithubSectionSkeleton() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-live="polite"
      aria-label="Loading GitHub connection"
    >
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-3.5 w-full max-w-md" />
      </div>

      <div className="rounded-xl border border-border/50 bg-card/50 p-6 space-y-4">
        <div className="rounded-lg border border-border/60 bg-muted/30 p-4 flex items-center gap-4">
          <Skeleton className="h-11 w-11 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md shrink-0" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
    </div>
  );
}
