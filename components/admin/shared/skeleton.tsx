import { cn } from "@/lib/ui/utils";

interface SkeletonProps {
  className?: string;
}

/**
 * Base skeleton component
 */
export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}

/**
 * Skeleton for users list
 */
export function UsersListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-4 border border-border rounded-lg"
        >
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for audit log
 */
export function AuditLogSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-start gap-3 p-4 border border-border rounded-lg"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for user detail panel
 */
export function UserDetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

/**
 * Skeleton for staff list
 */
export function StaffListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-4 border border-border rounded-lg"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for teams list
 */
export function TeamsListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-4 border border-border rounded-lg"
        >
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * Skeleton for the inline stat bar (see shared/stat-card.tsx StatBar)
 */
export function StatBarSkeleton({ segments = 5 }: { segments?: number }) {
  return (
    <div className="flex flex-wrap rounded-lg border border-border/50 bg-border/50 gap-px overflow-hidden">
      {Array.from({ length: segments }).map((_, i) => (
        <div key={i} className="flex-1 min-w-28 bg-card px-4 py-3 space-y-1.5">
          <Skeleton className="h-5 w-10" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
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
