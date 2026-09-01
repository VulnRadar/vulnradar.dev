import { cn } from "@/lib/ui/utils";
import { StatStripSkeleton } from "@/components/shared/stat-strip";

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton component
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

// The five bespoke per-section skeletons that used to sit here
// (UsersListSkeleton, AuditLogSkeleton, UserDetailSkeleton, StaffListSkeleton,
// TeamsListSkeleton) are gone. They were written against an older card-row
// layout, were only ever reachable through this directory's wildcard barrel,
// and had zero importers: every admin section renders DataTableSkeleton or
// StatBarSkeleton below, which match the table layout the panel actually uses.
// Keeping shapes that mirror a layout the panel no longer has would produce
// MORE layout shift, not less, so the generic pair is the one to extend.

/**
 * Skeleton for the inline stat bar (see shared/stat-card.tsx StatBar).
 * Delegates to the shared strip's own skeleton so the two cannot drift: this
 * copy still drew the pre-consolidation container and had no icon square at
 * all, so every admin panel visibly reflowed the moment its counts landed.
 */
export function StatBarSkeleton({ segments = 5 }: { segments?: number }) {
  return <StatStripSkeleton cells={segments} size="sm" />;
}

/**
 * Skeleton for the Overview tab's health list: a dot, a label with its value
 * on the same baseline, and a one-line detail underneath, matching the rows
 * HealthOverview renders. Lives here rather than in health-overview.tsx so the
 * route-level loading.tsx (a server component, via AdminSkeleton) and the
 * card's own pre-fetch state can draw the same shape. Before this existed the
 * panel drew a stat strip and then a user table on the way to a status list,
 * so nothing that flashed resembled what arrived.
 */
export function HealthListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-border/50 border-t border-border/50">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-4">
          <Skeleton className="mt-1.5 h-2 w-2 rounded-full shrink-0" />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-full max-w-[46ch]" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The whole System Health card: state icon, title, refresh control, list.
 * Three separate skeletons used to stand in for this one panel on the way to
 * it (the route-level loading.tsx, the dynamic import's fallback, and the
 * card's own pre-fetch state), and none of the three was its shape.
 */
export function HealthCardSkeleton() {
  return (
    <div className="rounded-lg border border-border/50 bg-card/50 shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-9 sm:w-[6.5rem] rounded-md shrink-0" />
      </div>
      <HealthListSkeleton />
    </div>
  );
}

/**
 * Skeleton for a settings tab body: clustered rows of label + description
 * on the left, a control on the right, matching SettingField's layout in
 * system-settings-manager.tsx.
 */
export function SettingsFieldsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border/40 overflow-hidden divide-y divide-border/40">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 px-4 sm:px-5 py-4"
        >
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-full max-w-[30ch]" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for a data table: header bar + N rows, matches the
 * TableScrollArea + Table pattern used across the admin panel.
 */
export function DataTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div className="h-10 bg-muted/30 border-b border-border/50" />
      <div className="divide-y divide-border/40">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-4">
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
