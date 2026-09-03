import { Skeleton } from "@/components/ui/skeleton";
import { PREF_GROUPS } from "./unsubscribe-prefs";

/**
 * Two exports over one shape, for the two things that wait on /unsubscribe.
 *
 * UnsubscribePrefsSkeleton is the region UnsubscribeContent swaps in while the
 * token is being checked: the h1 above it is a constant, so the page keeps it
 * on screen rather than replacing the whole view with grey. UnsubscribeSkeleton
 * is that region under the same real heading, for the Suspense boundary the
 * useSearchParams call needs, which renders before the content component
 * exists at all.
 *
 * Row counts come from PREF_GROUPS itself, not from a hand-typed
 * [5, 4, 4, 4, 2] that nobody would think to update when a nineteenth
 * preference becomes a twentieth.
 */
export function UnsubscribePrefsSkeleton() {
  return (
    <div
      className="space-y-8"
      role="status"
      aria-live="polite"
      aria-label="Loading email preferences"
    >
      <div className="space-y-6">
        {PREF_GROUPS.map((group) => (
          <div key={group.label}>
            <Skeleton className="h-4 w-20 mb-2" />
            <div className="divide-y divide-border/40 rounded-lg border border-border/50 overflow-hidden">
              {group.rows.map((row) => (
                <div
                  key={row.key}
                  // py-3.5 and the card tint, both of which the loaded row has
                  // and this did not: 19 rows at 4px short is 76px of drift,
                  // and the list went from transparent to tinted on arrival.
                  className="flex items-start justify-between gap-4 bg-card/30 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-full max-w-[36ch]" />
                  </div>
                  {/* Switch is h-6 w-11 (components/ui/switch.tsx), not the
                      20x36 this drew. */}
                  <Skeleton className="mt-0.5 h-6 w-11 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* The save-state line and the 44px "Unsubscribe from all" button. The
          placeholder ended at the last group, so this whole row appeared under
          the reader once the preferences resolved. */}
      <div className="flex items-start justify-between gap-4 pt-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-11 w-44 shrink-0" />
      </div>
    </div>
  );
}

export function UnsubscribeSkeleton() {
  return (
    <div className="space-y-8">
      {/* Real heading, placeholder subtitle: which screen this is was never
          waiting on the token, only whose address it is managing. */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Email preferences
        </h1>
        <Skeleton className="mt-1.5 h-4 w-56" />
      </div>

      <UnsubscribePrefsSkeleton />
    </div>
  );
}
