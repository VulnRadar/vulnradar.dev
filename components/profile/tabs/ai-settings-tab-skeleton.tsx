import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors ProfileAiSettingsTab's real layout (the on/off toggle card, then
 * the AI provider choice cards) so the config fetch's loading state doesn't
 * reflow into a differently-shaped tab once it resolves.
 */
export function AiSettingsTabSkeleton() {
  return (
    <div
      className="flex flex-col gap-8"
      role="status"
      aria-live="polite"
      aria-label="Loading AI settings"
    >
      <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-border/50 bg-card/50">
        <div className="flex items-center gap-3 min-w-0">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-5 w-9 rounded-full shrink-0" />
      </div>

      <div>
        <div className="mb-4 space-y-1.5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="p-4 rounded-xl border border-border space-y-2"
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
