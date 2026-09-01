import { Skeleton } from "@/components/ui/skeleton";

const NAV_LABEL_WIDTHS = ["w-16", "w-20", "w-28", "w-16"];

/**
 * Mirrors ProfileDeveloperTab's real layout (the API Keys / Webhooks /
 * Scheduled Scans / GitHub sub-tab nav, then the active section's list) so
 * the preload fetch's loading state doesn't reflow into a differently
 * shaped tab once it resolves.
 */
export function DeveloperTabSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-live="polite"
      aria-label="Loading developer settings"
    >
      {/* overflow-x-auto to match the real strip in
          components/profile/tabs/profile-developer-tab.tsx: without it the
          four items squashed on a phone and then jumped to a scrolled row the
          moment the real tabs replaced them. */}
      <div className="flex gap-4 overflow-x-auto scrollbar-hide border-b border-border/80 -mx-1 px-1">
        {NAV_LABEL_WIDTHS.map((width, i) => (
          <div key={i} className="flex items-center gap-2 px-1 py-2.5">
            <Skeleton className="h-4 w-4 rounded shrink-0" />
            <Skeleton className={`h-4 ${width}`} />
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md shrink-0" />
      </div>

      <div className="rounded-md border border-border overflow-hidden divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <Skeleton className="h-8 w-8 rounded-md shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
            <Skeleton className="h-8 w-8 rounded-md shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
